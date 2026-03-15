#!/usr/bin/env node
/*
 * Cleanup conversations script
 * Keeps only the N most recent conversations per user and deletes older conversations and their messages.
 * Usage: node scripts/cleanup-conversations.js [--keep=20] [--dry-run]
 */

require('dotenv').config();
const { connectDb } = require('../api/db/connect');
const { Conversation, Message } = require('../api/db/models');
const fs = require('fs');
const path = require('path');

async function main() {
  const keep = parseInt(process.argv.find(a => a.startsWith('--keep='))?.split('=')[1] || process.env.CLEANUP_KEEP_CONVOS || '20', 10);
  const dryRun = process.argv.includes('--dry-run');

  console.log(`Cleanup conversations: keep=${keep}, dryRun=${dryRun}`);

  await connectDb();

  const users = await Conversation.distinct('user');
  console.log(`Found ${users.length} users with conversations.`);

  let totalConvosDeleted = 0;
  let totalMessagesDeleted = 0;

  for (const user of users) {
    const convos = await Conversation.find({ user }).select('conversationId updatedAt').sort({ updatedAt: -1 }).lean();
    if (!convos || convos.length <= keep) continue;

    const toRemove = convos.slice(keep);
    const toRemoveIds = toRemove.map(c => c.conversationId).filter(Boolean);
    if (!toRemoveIds.length) continue;

    console.log(`User ${user}: will remove ${toRemoveIds.length} conversations.`);

    if (!dryRun) {
      const convoResult = await Conversation.deleteMany({ user, conversationId: { $in: toRemoveIds } });
      const msgResult = await Message.deleteMany({ user, conversationId: { $in: toRemoveIds } });
      totalConvosDeleted += convoResult.deletedCount || 0;
      totalMessagesDeleted += msgResult.deletedCount || 0;
    } else {
      totalConvosDeleted += toRemoveIds.length;
      // messages unknown in dry-run
    }
  }

  console.log(`Cleanup complete. Conversations scheduled/deleted: ${totalConvosDeleted}. Messages deleted (if run): ${totalMessagesDeleted}`);
}

main().catch((err) => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
