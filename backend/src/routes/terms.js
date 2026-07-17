// terms.js
//
// The authoritative list of terms. Admin creates them here once;
// every other screen (gradebook, exams, fees) picks from this list
// via dropdown instead of free-typing a term name, so it can never
// drift into near-duplicates like "Term 2, 2026" vs "term 2 2026".

const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/terms', requireAuth, async (req, res) => {
  const terms = await prisma.term.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(terms);
});

router.post('/terms', requireAuth, requireRole('admin'), async (req, res) => {
  const { name, startDate, endDate } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const existing = await prisma.term.findUnique({ where: { name } });
  if (existing) return res.status(409).json({ error: 'This term already exists' });

  const term = await prisma.term.create({
    data: { name, startDate: startDate ? new Date(startDate) : null, endDate: endDate ? new Date(endDate) : null },
  });
  res.status(201).json(term);
});

// Sets one term as "current" and unsets any other — only ever one
// current term at a time, used to default dropdowns across the app.
router.post('/terms/:id/set-current', requireAuth, requireRole('admin'), async (req, res) => {
  await prisma.term.updateMany({ data: { isCurrent: false }, where: {} });
  const term = await prisma.term.update({
    where: { id: req.params.id },
    data: { isCurrent: true },
  });
  res.json(term);
});

router.delete('/terms/:id', requireAuth, requireRole('admin'), async (req, res) => {
  await prisma.term.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

module.exports = router;
