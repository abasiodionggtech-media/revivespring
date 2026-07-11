'use strict';

/**
 * src/jobs/weeklyReviewJob.js
 *
 * Runs daily (like the other jobs in this app). On any day, it checks
 * whether "this week's" review window has a Sunday in the past — in
 * practice this means it only actually creates new reviews once Sunday
 * has arrived, satisfying "runs every Sunday automatically" — but
 * checking daily (rather than trying to fire exactly at midnight Sunday)
 * means it's resilient to the server restarting or a deploy happening
 * around the boundary.
 *
 * Only processes users who've been active in the last 14 days, to avoid
 * spending AI calls generating reviews for dormant accounts.
 */

const prisma = require('../config/prisma');
const { currentReviewWeek, getOrCreateReview } = require('../routes/weeklyReview');

async function runWeeklyReviewJob() {
  const { weekEndDate } = currentReviewWeek();
  const today = new Date().toISOString().split('T')[0];

  // Only run the generation pass on the review week's Sunday itself (or
  // later, in case the job missed a day) — not on Mon-Sat, when the week
  // the review would cover hasn't finished yet.
  if (today < weekEndDate) {
    return { generated: 0, skipped: 'week not finished yet' };
  }

  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  const cutoff = fourteenDaysAgo.toISOString().split('T')[0];

  const activeAnalytics = await prisma.analytics.findMany({
    where: { lastActiveDate: { gte: cutoff } },
    select: { userId: true },
  });

  let generated = 0;
  for (const { userId } of activeAnalytics) {
    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) continue;
      await getOrCreateReview(user, user.language || 'en');
      generated += 1;
    } catch (err) {
      console.error(`[WEEKLY-REVIEW-JOB] Failed for user ${userId}:`, err.message);
    }
  }

  return { generated };
}

module.exports = { runWeeklyReviewJob };
