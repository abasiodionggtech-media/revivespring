'use strict';

/**
 * Deletes regular-user records while preserving admins and managed content.
 *
 * Render Shell:
 *   npm run reset:regular-users
 *   RESET_REGULAR_USERS=YES npm run reset:regular-users
 *
 * The first command is a dry run. The second performs the deletion.
 */

require('dotenv').config();
const prisma = require('../src/config/prisma');

const confirmed = process.env.RESET_REGULAR_USERS === 'YES';

async function countUserData(userIds, userEmails) {
  const [prayers, journals, goals, analytics, aiConversations] = await Promise.all([
    prisma.prayer.count({ where: { userId: { in: userIds } } }),
    prisma.journalEntry.count({ where: { userId: { in: userIds } } }),
    prisma.dailyGoal.count({ where: { userId: { in: userIds } } }),
    prisma.analytics.count({ where: { userId: { in: userIds } } }),
    prisma.aiConversation.count({ where: { userEmail: { in: userEmails } } }),
  ]);

  return { prayers, journals, goals, analytics, aiConversations };
}

async function main() {
  const regularUsers = await prisma.user.findMany({
    where: { role: 'user' },
    select: { id: true, email: true },
  });
  const userIds = regularUsers.map((user) => user.id);
  const userEmails = regularUsers.map((user) => user.email);

  if (regularUsers.length === 0) {
    console.log('No regular users found. Nothing to reset.');
    return;
  }

  const counts = await countUserData(userIds, userEmails);
  console.log('Regular-user reset summary:');
  console.log('  users:', regularUsers.length);
  console.log('  prayers:', counts.prayers);
  console.log('  journal entries:', counts.journals);
  console.log('  daily goals:', counts.goals);
  console.log('  analytics rows:', counts.analytics);
  console.log('  linked AI conversations:', counts.aiConversations);
  console.log('  admin accounts: preserved');
  console.log('  managed content: preserved');

  if (!confirmed) {
    console.log('');
    console.log('Dry run only. No records were deleted.');
    console.log('To perform the reset, run:');
    console.log('  RESET_REGULAR_USERS=YES npm run reset:regular-users');
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.aiConversation.deleteMany({
      where: { userEmail: { in: userEmails } },
    });
    await tx.user.deleteMany({
      where: { role: 'user' },
    });
  });

  console.log('');
  console.log('Reset complete. Regular users and their linked data were deleted.');
}

main()
  .catch((error) => {
    console.error('Regular-user reset failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
