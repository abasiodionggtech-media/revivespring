'use strict';
const express = require('express');
const prisma  = require('../config/prisma');

const router = express.Router();

router.post('/save', async (req, res, next) => {
  try {
    const data = { onboardingData: req.body };
    if (req.body.language) data.language = req.body.language;
    if (req.body.reminderTime) {
      const hour = Number(req.body.reminderTime.hour);
      const minute = Number(req.body.reminderTime.minute);
      if (Number.isInteger(hour) && hour >= 0 && hour <= 23) {
        data.reminderHour = hour;
        data.registeredHour = hour;
      }
      if (Number.isInteger(minute) && minute >= 0 && minute <= 59) {
        data.reminderMinute = minute;
      }
      if (req.body.reminderTime.timezone) data.timezone = String(req.body.reminderTime.timezone);
      if (req.body.reminderTime.dailyEmailEnabled !== undefined) data.dailyEmailEnabled = !!req.body.reminderTime.dailyEmailEnabled;
      if (req.body.reminderTime.pushNotificationsEnabled !== undefined) data.pushNotificationsEnabled = !!req.body.reminderTime.pushNotificationsEnabled;
    }
    const user = await prisma.user.update({ where: { id: req.user.id }, data });
    res.json({ saved: true, onboardingData: user.onboardingData });
  } catch (err) {
    next(err);
  }
});

router.get('/wellness', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [analytics, prayerCount, journalCount, totalGoals, completedGoals, weeklyCounts] = await Promise.all([
      prisma.analytics.upsert({
        where: { userId },
        create: { userId },
        update: {},
      }),
      prisma.prayer.count({ where: { userId } }),
      prisma.journalEntry.count({ where: { userId } }),
      prisma.dailyGoal.count({ where: { userId } }),
      prisma.dailyGoal.count({ where: { userId, completed: true } }),
      (async () => {
        const today = new Date();
        const days = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date(today);
          d.setDate(today.getDate() - i);
          days.push(d.toISOString().split('T')[0]);
        }
        return Promise.all(days.map(date => prisma.dailyGoal.count({ where: { userId, date, completed: true } })));
      })(),
    ]);

    const profile = req.user.onboardingData || {};
    const prayerScore = Math.min(100, prayerCount * 6);
    const journalScore = Math.min(100, journalCount * 8);
    const goalsScore = totalGoals ? Math.round((completedGoals / totalGoals) * 100) : 0;
    const streakScore = Math.min(100, analytics.currentStreak * 10);
    const overall = Math.round((prayerScore + journalScore + goalsScore + streakScore) / 4);

    const actions = [];
    if (prayerCount < 3) actions.push({ type: 'prayer', icon: '🙏', en: 'Spend one minute in prayer right now to build your daily rhythm.', fr: 'Prenez une minute de prière maintenant pour construire votre rythme quotidien.' });
    if (journalCount < 2) actions.push({ type: 'journal', icon: '📓', en: 'Write one entry about what God is doing in your life today.', fr: 'Écrivez une entrée sur ce que Dieu fait dans votre vie aujourd’hui.' });
    if (goalsScore < 50) actions.push({ type: 'goals', icon: '🎯', en: 'Complete one small goal to move your streak forward.', fr: 'Terminez un petit objectif pour faire progresser votre série.' });
    if (analytics.currentStreak < 2) actions.push({ type: 'streak', icon: '🔥', en: 'Open a prayer and stay 60 seconds to record your next streak day.', fr: 'Ouvrez une prière et restez 60 secondes pour enregistrer votre prochaine journée de série.' });
    if (!actions.length) actions.push({ type: 'encouragement', icon: '🌟', en: 'You are on a great path. Keep engaging with prayer and scripture.', fr: 'Vous êtes sur une belle voie. Continuez avec la prière et l’Écriture.' });

    res.json({
      overall,
      insight: overall >= 80
        ? 'Your spiritual life is growing strong. Keep the momentum with short daily prayer moments.'
        : overall >= 55
          ? 'You are making meaningful progress. Keep pressing in with consistent prayer and goals.'
          : 'Start with one small prayer and one short goal today to build a stronger rhythm.',
      pillars: {
        prayer: { score: prayerScore, count: prayerCount },
        journal: { score: journalScore, count: journalCount },
        goals: { score: goalsScore, count: completedGoals },
        streak: { score: streakScore, count: analytics.currentStreak },
      },
      profile,
      actions,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
