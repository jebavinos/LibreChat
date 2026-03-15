#!/usr/bin/env node
/**
 * Cleanup data folder script
 * Removes files under /app/data, /app/plots, and /tmp that are older than retentionDays.
 * Usage: node scripts/cleanup-data-folder.js [--days=30] [--dry-run] [--max-files=1000]
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const retentionDays = parseInt(process.argv.find(a => a.startsWith('--days='))?.split('=')[1] || process.env.DATA_RETENTION_DAYS || '30', 10);
const dryRun = process.argv.includes('--dry-run');
const maxFiles = parseInt(process.argv.find(a => a.startsWith('--max-files='))?.split('=')[1] || process.env.DATA_MAX_FILES || '1000', 10);

const dirs = [path.join(__dirname, '..', 'data'), path.join(__dirname, '..', 'app', 'data'), '/tmp', path.join(__dirname, '..', 'app', 'plots')];

async function cleanupDir(dir) {
  if (!fs.existsSync(dir)) return { removed: 0, total: 0 };
  const files = fs.readdirSync(dir).map(f => ({ f, full: path.join(dir, f), stat: fs.statSync(path.join(dir, f)) })).filter(x => x.stat.isFile());
  const now = Date.now();
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;

  // Remove files older than cutoff
  let removed = 0;
  for (const item of files) {
    if (item.stat.mtimeMs < cutoff) {
      console.log(`${dryRun ? 'Would remove' : 'Removing'}: ${item.full}`);
      if (!dryRun) {
        try { fs.unlinkSync(item.full); removed++; } catch (e) { console.warn('Failed to remove', item.full, e.message); }
      } else {
        removed++;
      }
    }
  }

  // Enforce max files: keep newest maxFiles, remove oldest beyond that
  const remaining = fs.readdirSync(dir).map(f => ({ f, full: path.join(dir, f), stat: fs.statSync(path.join(dir, f)) })).filter(x => x.stat.isFile());
  remaining.sort((a,b) => b.stat.mtimeMs - a.stat.mtimeMs); // newest first
  if (remaining.length > maxFiles) {
    const toDelete = remaining.slice(maxFiles);
    for (const item of toDelete) {
      console.log(`${dryRun ? 'Would remove' : 'Removing (max-files)'}: ${item.full}`);
      if (!dryRun) {
        try { fs.unlinkSync(item.full); removed++; } catch (e) { console.warn('Failed to remove', item.full, e.message); }
      } else {
        removed++;
      }
    }
  }

  return { removed, total: files.length };
}

async function main() {
  console.log(`Cleanup data folders: retentionDays=${retentionDays}, maxFiles=${maxFiles}, dryRun=${dryRun}`);
  let totalRemoved = 0; let totalFiles = 0;
  for (const dir of dirs) {
    try {
      const res = await cleanupDir(dir);
      totalRemoved += res.removed;
      totalFiles += res.total;
    } catch (e) {
      console.warn('Skipping', dir, e.message);
    }
  }
  console.log(`Data cleanup complete. Files checked: ${totalFiles}. Files removed (or to remove in dry-run): ${totalRemoved}`);
}

main().catch(err => { console.error('Data cleanup failed:', err); process.exit(1); });
