'use strict';
const express = require('express');
const prisma = require('../config/prisma');
const { isPremiumUser } = require('../services/monetization');

const router = express.Router();

function formatTrack(track) {
  return {
    id: track.id,
    title: track.titleEn,
    artist: track.artist,
    platform: track.platform,
    url: track.url,
    category: track.category,
    duration_label: track.durationLabel,
  };
}

// GET /api/worship-tracks
router.get('/', async (req, res, next) => {
  try {
    if (!isPremiumUser(req.user)) {
      return res.status(403).json({ message: 'Worship Mode is a Premium feature.', code: 'PREMIUM_REQUIRED' });
    }
    const tracks = await prisma.worshipTrack.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
    res.json(tracks.map(formatTrack));
  } catch (err) { next(err); }
});

module.exports = router;
