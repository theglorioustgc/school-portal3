// gradingScheme.js
//
// The "marking scheme": configurable grade boundaries (A1, B2, F9...)
// and informational max scores per component (CA1/CA2/CA3/Exam).
// Looked up live wherever a report card is generated — not baked
// into individual grade records, so changing the scheme applies
// going forward without needing to rewrite old data.

const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// ------------------------------------------------------------------
// GRADE BOUNDARIES
// ------------------------------------------------------------------
router.get('/grading-scheme', requireAuth, async (req, res) => {
  const boundaries = await prisma.gradeBoundary.findMany({ orderBy: { minScore: 'desc' } });
  res.json(boundaries);
});

router.post('/grading-scheme', requireAuth, requireRole('admin'), async (req, res) => {
  const { grade, minScore, maxScore, remark } = req.body;
  if (!grade || minScore === undefined || maxScore === undefined || !remark) {
    return res.status(400).json({ error: 'grade, minScore, maxScore, and remark are required' });
  }
  const boundary = await prisma.gradeBoundary.create({
    data: { grade, minScore: parseFloat(minScore), maxScore: parseFloat(maxScore), remark },
  });
  res.status(201).json(boundary);
});

router.put('/grading-scheme/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { grade, minScore, maxScore, remark } = req.body;
  const boundary = await prisma.gradeBoundary.update({
    where: { id: req.params.id },
    data: { grade, minScore: parseFloat(minScore), maxScore: parseFloat(maxScore), remark },
  });
  res.json(boundary);
});

router.delete('/grading-scheme/:id', requireAuth, requireRole('admin'), async (req, res) => {
  await prisma.gradeBoundary.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// ------------------------------------------------------------------
// MAX SCORES (CA1/CA2/CA3/Exam) — stored on SchoolConfig
// ------------------------------------------------------------------
router.get('/grading-scheme/marks-config', requireAuth, async (req, res) => {
  const config = await prisma.schoolConfig.findFirst();
  res.json({
    ca1Max: config?.ca1Max ?? 10,
    ca2Max: config?.ca2Max ?? 10,
    ca3Max: config?.ca3Max ?? 10,
    examMax: config?.examMax ?? 70,
  });
});

router.put('/grading-scheme/marks-config', requireAuth, requireRole('admin'), async (req, res) => {
  const { ca1Max, ca2Max, ca3Max, examMax } = req.body;
  const config = await prisma.schoolConfig.findFirst();

  if (!config) {
    return res.status(400).json({ error: 'No school config exists yet. Set up SchoolConfig first.' });
  }

  const updated = await prisma.schoolConfig.update({
    where: { id: config.id },
    data: { ca1Max, ca2Max, ca3Max, examMax },
  });
  res.json(updated);
});

module.exports = router;
