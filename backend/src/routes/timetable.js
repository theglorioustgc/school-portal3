// timetable.js
//
// Manages the class timetable grid. Enforces the two conflict
// rules we agreed on, checked server-side before any save:
//   1. A teacher can't be double-booked (same day+period, different class)
//   2. A class can't be double-booked (same day+period, two different subjects)

const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// ------------------------------------------------------------------
// GET /timetable?classId=xxx   -> full week grid for one class
// GET /timetable?teacherId=xxx -> full week grid for one teacher
// ------------------------------------------------------------------
router.get('/timetable', requireAuth, async (req, res) => {
  const { classId, teacherId } = req.query;
  const where = {};
  if (classId) where.classId = classId;
  if (teacherId) where.teacherId = teacherId;

  const entries = await prisma.timetableEntry.findMany({
    where,
    include: { class: true, subject: true, teacher: true },
    orderBy: [{ dayOfWeek: 'asc' }, { periodNumber: 'asc' }],
  });
  res.json(entries);
});

// ------------------------------------------------------------------
// POST /timetable -> create one slot, admin only, with conflict checks
// ------------------------------------------------------------------
router.post('/timetable', requireAuth, requireRole('admin'), async (req, res) => {
  const { classId, subjectId, teacherId, dayOfWeek, periodNumber } = req.body;

  if (!classId || !subjectId || !teacherId || !dayOfWeek || !periodNumber) {
    return res.status(400).json({
      error: 'classId, subjectId, teacherId, dayOfWeek, and periodNumber are all required',
    });
  }

  // --- Conflict check 1: is this teacher already booked at this day+period, for a different class? ---
  const teacherConflict = await prisma.timetableEntry.findFirst({
    where: {
      teacherId,
      dayOfWeek,
      periodNumber,
      NOT: { classId }, // same class re-saving isn't a conflict with itself
    },
    include: { class: true, teacher: true },
  });

  if (teacherConflict) {
    return res.status(409).json({
      error: `${teacherConflict.teacher.firstName} ${teacherConflict.teacher.lastName} is already teaching ${teacherConflict.class.name} at this time on ${dayOfWeek}. Choose a different period or teacher.`,
    });
  }

  // --- Conflict check 2: is this class already booked at this day+period, with a different subject? ---
  const classConflict = await prisma.timetableEntry.findFirst({
    where: {
      classId,
      dayOfWeek,
      periodNumber,
      NOT: { subjectId },
    },
    include: { subject: true },
  });

  if (classConflict) {
    return res.status(409).json({
      error: `This class already has ${classConflict.subject.name} scheduled at this time on ${dayOfWeek}. Choose a different period.`,
    });
  }

  // --- No conflicts: safe to save ---
  const entry = await prisma.timetableEntry.create({
    data: { classId, subjectId, teacherId, dayOfWeek, periodNumber },
  });

  res.status(201).json(entry);
});

// ------------------------------------------------------------------
// DELETE /timetable/:id -> remove one slot, admin only
// ------------------------------------------------------------------
router.delete('/timetable/:id', requireAuth, requireRole('admin'), async (req, res) => {
  await prisma.timetableEntry.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

module.exports = router;
