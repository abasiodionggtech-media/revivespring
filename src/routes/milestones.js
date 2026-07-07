'use strict';
const express = require('express');
const { checkAndAwardMilestones } = require('../services/milestones');

const router = express.Router();

// GET /api/milestones — list all badges with achieved/progress state (no new awards)
router.get('/', async (req, res, next) => {
  try {
    const { all } = await checkAndAwardMilestones(req.user.id);
    res.json({ milestones: all });
  } catch (err) {
    next(err);
  }
});

// POST /api/milestones/check — run the checker; awards any newly-earned badges
router.post('/check', async (req, res, next) => {
  try {
    const { all, newlyAwarded } = await checkAndAwardMilestones(req.user.id);
    res.json({ milestones: all, newlyAwarded });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
