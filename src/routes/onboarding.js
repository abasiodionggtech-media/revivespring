'use strict';

/**
 * src/routes/onboarding.js
 * Saves user onboarding answers + returns AI-generated wellness insight
 *
 * POST /api/onboarding/save    — save onboarding profile
 * GET  /api/onboarding/profile — get saved profile
 * GET  /api/onboarding/wellness — get wellness score + insights
 */

const express = require('express');
const prisma   = require('../config/prisma');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

/* ─── POST /api/onboarding/save ─────────────────────────── */
router.post('/save', async (req, res, next) => {
  try {
    const {
      topicFirst,           // string: first topic to explore
      motivations,          // string[]: what motivates spiritual growth
      findGodIn,            // string[]: how they find God
      devotionalStyle,      // string: simple/deep/uplifting/guided
      timePerDay,           // string: 5/10/15/20 min
      lifeTooBusy,          // string: all_the_time/sometimes/rarely/never
      struggleLivingBeliefs,// string: yes_always/sometimes/rarely/never
      agreeBalance,         // boolean: spending time on spiritual growth feels balanced
      agreeMindWanders,     // boolean: mind wanders when reading
      agreeScriptureHard,   // boolean: scripture sometimes hard to interpret
    } = req.body;

    // Store as JSON in AppSetting keyed by userId
    const key   = 'onboarding_' + req.user.id;
    const value = JSON.stringify({
      topicFirst, motivations, findGodIn, devotionalStyle,
      timePerDay, lifeTooBusy, struggleLivingBeliefs,
      agreeBalance, agreeMindWanders, agreeScriptureHard,
      completedAt: new Date().toISOString(),
    });

    await prisma.appSetting.upsert({
      where:  { key },
      update: { value },
      create: { key, value },
    });

    // Update user language pref if provided
    if (req.body.language) {
      await prisma.user.update({
        where: { id: req.user.id },
        data:  { language: req.body.language },
      });
    }

    res.json({ message: 'Onboarding profile saved.' });
  } catch (err) { next(err); }
});

/* ─── GET /api/onboarding/profile ───────────────────────── */
router.get('/profile', async (req, res, next) => {
  try {
    const key     = 'onboarding_' + req.user.id;
    const setting = await prisma.appSetting.findUnique({ where: { key } });
    if (!setting) return res.json(null);
    res.json(JSON.parse(setting.value));
  } catch (err) { next(err); }
});

/* ─── GET /api/onboarding/wellness ──────────────────────── */
router.get('/wellness', async (req, res, next) => {
  try {
    const userId  = req.user.id;
    const isFr    = req.user.language === 'fr';

    // Gather real usage data
    const [analytics, prayers, journals, goals, profileSetting] = await Promise.all([
      prisma.analytics.findUnique({ where: { userId } }),
      prisma.prayer.count({ where: { userId } }),
      prisma.journalEntry.count({ where: { userId } }),
      prisma.dailyGoal.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 14,
      }),
      prisma.appSetting.findUnique({ where: { key: 'onboarding_' + userId } }),
    ]);

    const profile  = profileSetting ? JSON.parse(profileSetting.value) : {};
    const streak   = analytics?.currentStreak || 0;
    const answered = analytics?.answeredPrayers || 0;
    const totalGoals     = goals.length;
    const completedGoals = goals.filter(g => g.completed).length;

    // Calculate pillar scores (0-100)
    const prayerScore  = Math.min(100, prayers * 8 + streak * 5);
    const journalScore = Math.min(100, journals * 10 + answered * 15);
    const goalsScore   = totalGoals > 0 ? Math.round(completedGoals / totalGoals * 100) : 0;
    const streakScore  = Math.min(100, streak * 10);
    const overall      = Math.round((prayerScore + journalScore + goalsScore + streakScore) / 4);

    // Generate AI-style insight based on data + onboarding
    let insight = '';
    if (isFr) {
      if (streak >= 7)        insight = `Votre constance de ${streak} jours est remarquable. La Parole dit: "Cherchez l'Éternel pendant qu'il se trouve." Continuez!`;
      else if (prayers >= 10) insight = `Vous avez généré ${prayers} prières — Dieu entend chacune d'elles. Ajoutez maintenant des objectifs quotidiens pour renforcer votre croissance.`;
      else if (journals > 0)  insight = `Votre journal montre ${answered} prières exaucées. Prenez un moment pour célébrer la fidélité de Dieu.`;
      else                    insight = `Bienvenue dans votre voyage! Commencez par une prière simple aujourd'hui. Même 5 minutes avec Dieu peuvent transformer votre journée.`;
    } else {
      if (streak >= 7)        insight = `Your ${streak}-day streak shows real commitment. Proverbs 4:18 says "The path of the righteous is like the morning sun, shining ever brighter." Keep going!`;
      else if (prayers >= 10) insight = `You've generated ${prayers} prayers — God hears every one. Try adding daily goals to deepen your spiritual habits.`;
      else if (journals > 0)  insight = `Your journal shows ${answered} answered prayers. Take a moment to celebrate God's faithfulness in your life.`;
      else                    insight = `Welcome to your journey! Start with one simple prayer today. Even 5 minutes with God can transform your entire day.`;
    }

    // Recommended actions based on weakest pillar
    const actions = [];
    if (prayerScore  < 40) actions.push({ type:'prayer',  icon:'🙏', en:'Generate a Prayer', fr:'Générer une Prière' });
    if (journalScore < 40) actions.push({ type:'journal',  icon:'📓', en:'Write in Journal',  fr:'Écrire dans le Journal' });
    if (goalsScore   < 40) actions.push({ type:'goals',   icon:'🎯', en:'Set a Daily Goal',  fr:'Définir un Objectif' });
    if (streak       <  3) actions.push({ type:'streak',  icon:'🔥', en:'Build Your Streak', fr:'Construire Votre Série' });

    res.json({
      overall,
      pillars: {
        prayer:  { score: prayerScore,  count: prayers },
        journal: { score: journalScore, count: journals },
        goals:   { score: goalsScore,   count: completedGoals + '/' + totalGoals },
        streak:  { score: streakScore,  count: streak },
      },
      insight,
      actions,
      profile,
    });
  } catch (err) { next(err); }
});

module.exports = router;
