// gradebook.js
//
// Draft -> submitted flow for CA1/CA2/CA3/exam scores.
// Same permission rule as attendance: only the teacher assigned
// to this specific class+subject (or an admin) can write to it —
// but here it's subject-specific, unlike attendance which is
// any-subject-assigned.
//
// Submitted records lock (can't be edited directly) — reopening
// requires an explicit admin action, so there's always a clear
// audit trail of who unlocked what.

const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

/** Confirms the logged-in user can write grades for this class+subject */
async function canGradeSubject(user, classId, subjectId) {
  if (user.role === 'admin') return true;
  if (user.role !== 'teacher') return false;

  const assignment = await prisma.teacherAssignment.findFirst({
    where: { teacherId: user.id, classId, subjectId },
  });
  return !!assignment;
}

function computeTotal({ ca1, ca2, ca3, exam }) {
  const parts = [ca1, ca2, ca3, exam].filter((v) => v !== null && v !== undefined);
  if (parts.length === 0) return null;
  return parts.reduce((sum, v) => sum + v, 0);
}

// ------------------------------------------------------------------
// GET /gradebook?classId=xxx&subjectId=xxx&term=xxx -> whole class's scores
// ------------------------------------------------------------------
router.get('/gradebook', requireAuth, async (req, res) => {
  const { classId, subjectId, term } = req.query;
  if (!classId || !subjectId || !term) {
    return res.status(400).json({ error: 'classId, subjectId, and term query params are required' });
  }

  const records = await prisma.gradeRecord.findMany({
    where: { classId, subjectId, term },
    include: { student: true },
  });
  res.json(records);
});

// ------------------------------------------------------------------
// POST /gradebook/save -> create or update ONE student's scores (draft)
// Body: { studentId, classId, subjectId, term, ca1, ca2, ca3, exam }
// ------------------------------------------------------------------
router.post('/gradebook/save', requireAuth, requireRole('admin', 'teacher'), async (req, res) => {
  const { studentId, classId, subjectId, term, ca1, ca2, ca3, exam } = req.body;

  if (!studentId || !classId || !subjectId || !term) {
    return res.status(400).json({ error: 'studentId, classId, subjectId, and term are required' });
  }

  const allowed = await canGradeSubject(req.user, classId, subjectId);
  if (!allowed) {
    return res.status(403).json({ error: 'You are not assigned to teach this subject for this class' });
  }

  // Block edits to already-submitted records (must be reopened by admin first)
  const existing = await prisma.gradeRecord.findUnique({
    where: { studentId_subjectId_term: { studentId, subjectId, term } },
  });
  if (existing && existing.status === 'submitted') {
    return res.status(409).json({ error: 'This record is already submitted and locked. Ask an admin to reopen it.' });
  }

  const total = computeTotal({ ca1, ca2, ca3, exam });
  const enteredById = req.user.role === 'teacher' ? req.user.id : null;

  const record = await prisma.gradeRecord.upsert({
    where: { studentId_subjectId_term: { studentId, subjectId, term } },
    update: { ca1, ca2, ca3, exam, total, classId, enteredById, status: 'draft' },
    create: { studentId, classId, subjectId, term, ca1, ca2, ca3, exam, total, enteredById, status: 'draft' },
  });

  res.status(201).json(record);
});

// ------------------------------------------------------------------
// POST /gradebook/submit -> lock a whole class+subject's scores
// Body: { classId, subjectId, term }
// ------------------------------------------------------------------
router.post('/gradebook/submit', requireAuth, requireRole('admin', 'teacher'), async (req, res) => {
  const { classId, subjectId, term } = req.body;
  if (!classId || !subjectId || !term) {
    return res.status(400).json({ error: 'classId, subjectId, and term are required' });
  }

  const allowed = await canGradeSubject(req.user, classId, subjectId);
  if (!allowed) {
    return res.status(403).json({ error: 'You are not assigned to teach this subject for this class' });
  }

  const result = await prisma.gradeRecord.updateMany({
    where: { classId, subjectId, term, status: 'draft' },
    data: { status: 'submitted' },
  });

  res.json({ success: true, submittedCount: result.count });
});

// ------------------------------------------------------------------
// POST /gradebook/reopen -> admin-only, unlocks a submitted record
// Body: { studentId, subjectId, term }
// ------------------------------------------------------------------
router.post('/gradebook/reopen', requireAuth, requireRole('admin'), async (req, res) => {
  const { studentId, subjectId, term } = req.body;
  if (!studentId || !subjectId || !term) {
    return res.status(400).json({ error: 'studentId, subjectId, and term are required' });
  }

  const record = await prisma.gradeRecord.update({
    where: { studentId_subjectId_term: { studentId, subjectId, term } },
    data: { status: 'draft' },
  });

  res.json(record);
});

module.exports = router;
