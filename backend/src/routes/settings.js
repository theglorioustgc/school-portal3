// settings.js
//
// School-wide settings: name, logo, contact info, and the
// early-warning thresholds. Previously only editable via raw SQL —
// this gives admin a real screen for it. Upserts a single
// SchoolConfig row (creates one if none exists yet).

const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/settings', requireAuth, async (req, res) => {
  const config = await prisma.schoolConfig.findFirst();
  res.json(config || null);
});

router.put('/settings', requireAuth, requireRole('admin'), async (req, res) => {
  const {
    schoolName, logoUrl, contactEmail, contactPhone, schoolCode,
    attendanceAbsenceThreshold, attendanceRateThreshold,
    performanceDeclineThreshold, performanceLowThreshold,
  } = req.body;

  const existing = await prisma.schoolConfig.findFirst();

  const data = {
    schoolName, logoUrl, contactEmail, contactPhone,
    attendanceAbsenceThreshold, attendanceRateThreshold,
    performanceDeclineThreshold, performanceLowThreshold,
  };

  let config;
  if (existing) {
    config = await prisma.schoolConfig.update({ where: { id: existing.id }, data });
  } else {
    if (!schoolCode || !schoolName) {
      return res.status(400).json({ error: 'schoolCode and schoolName are required to create the initial settings' });
    }
    config = await prisma.schoolConfig.create({ data: { schoolCode, ...data } });
  }

  res.json(config);
});

module.exports = router;
