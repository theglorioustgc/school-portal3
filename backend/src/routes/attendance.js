// attendance.js
//
// Marks daily attendance for a whole class in one request.
// Permission rule: an admin can mark any class; a teacher can only
// mark a class they're actually assigned to (checked against
// TeacherAssignment — any subject counts, since attendance isn't
// subject-specific).

const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

/** Confirms the logged-in user is allowed to mark attendance for this class */
async function canMarkClass(user, classId) {
  if (user.role === 'admin') return true;
  if (user.role !== 'teacher') return false;

  const assignment = await prisma.teacherAssignment.findFirst({
    where: { teacherId: user.id, classId },
  });
  return !!assignment;
}

// ------------------------------------------------------------------
// GET /attendance?classId=xxx&date=2026-07-09 -> that day's records
// ------------------------------------------------------------------
router.get('/attendance', requireAuth, async (req, res) => {
  const { classId, date } = req.query;
  if (!classId || !date) {
    return res.status(400).json({ error: 'classId and date query params are required' });
  }

  const records = await prisma.attendanceRecord.findMany({
    where: { classId, date: new Date(date) },
    include: { student: true },
  });
  res.json(records);
});

// ------------------------------------------------------------------
// POST /attendance/mark -> bulk mark a whole class for one day
// Body: { classId, date, records: [{ studentId, status }, ...] }
// ------------------------------------------------------------------
router.post('/attendance/mark', requireAuth, requireRole('admin', 'teacher'), async (req, res) => {
  const { classId, date, records } = req.body;

  if (!classId || !date || !Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'classId, date, and a non-empty records array are required' });
  }

  const allowed = await canMarkClass(req.user, classId);
  if (!allowed) {
    return res.status(403).json({ error: 'You are not assigned to this class' });
  }

  const validStatuses = ['present', 'absent', 'late'];
  for (const r of records) {
    if (!r.studentId || !validStatuses.includes(r.status)) {
      return res.status(400).json({ error: 'Each record needs a studentId and a valid status (present/absent/late)' });
    }
  }

  const markedById = req.user.role === 'teacher' ? req.user.id : null;
  const attendanceDate = new Date(date);

  const results = await Promise.all(
    records.map((r) =>
      prisma.attendanceRecord.upsert({
        where: { studentId_date: { studentId: r.studentId, date: attendanceDate } },
        update: { status: r.status, markedById, classId },
        create: {
          studentId: r.studentId,
          classId,
          date: attendanceDate,
          status: r.status,
          markedById,
        },
      })
    )
  );

  res.status(201).json({ success: true, count: results.length });
});

module.exports = router;
