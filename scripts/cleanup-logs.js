#!/usr/bin/env node
/**
 * Simple log cleanup script
 * Removes log files in ./logs older than retentionDays (default 30)
 * Usage: node scripts/cleanup-logs.js [--days=30] [--dry-run]
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const retentionDays = parseInt(process.argv.find(a => a.startsWith('--days='))?.split('=')[1] || process.env.LOG_RETENTION_DAYS || '30', 10);
const dryRun = process.argv.includes('--dry-run');

const logsDir = path.join(__dirname, '..', 'logs');

async function main() {
  if (!fs.existsSync(logsDir)) {
    console.log('No logs directory found:', logsDir);
    return;
  }

  const files = fs.readdirSync(logsDir);
  const now = Date.now();
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;

  let removed = 0;
  for (const f of files) {
    const full = path.join(logsDir, f);
    try {
      const stat = fs.statSync(full);
      if (stat.isFile() && stat.mtimeMs < cutoff) {
        console.log(`${dryRun ? 'Would remove' : 'Removing'}: ${full}`);
        if (!dryRun) {
          fs.unlinkSync(full);
        }
        removed++;
      }
    } catch (e) {
      console.warn('Skipping', full, e.message);
    }
  }

  console.log(`Log cleanup complete. Files removed (or to remove in dry-run): ${removed}`);
}

main().catch((err) => {
  console.error('Log cleanup failed:', err);
  process.exit(1);
});
