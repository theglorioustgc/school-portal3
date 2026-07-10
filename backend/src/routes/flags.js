// flags.js
//
// Early-warning system. Two checks, both admin-triggered for now
// (in place of a real scheduled job, which we can wire up later
// without changing this logic at all):
//
//  1. Attendance: rolling 30-day window, flags on either an absolute
//     absence count OR a rate below threshold — whichever fires first.
//  2. Performance: two distinct flags — declining (drop vs the
//     student's own previous term) and consistently low (below an
//     absolute floor, regardless of trend).
//
// Cooldown: won't create a duplicate flag of the same type for the
// same student within 7 days, so it doesn't spam on every re-run.

const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

async function getThresholds() {
  const config = await prisma.schoolConfig.findFirst();
  return {
    attendanceAbsenceThreshold: config?.attendanceAbsenceThreshold ?? 3,
    attendanceRateThreshold: config?.attendanceRateThreshold ?? 0.85,
    performanceDeclineThreshold: config?.performanceDeclineThreshold ?? 10,
    performanceLowThreshold: config?.performanceLowThreshold ?? 40,
  };
}

async function alreadyFlaggedRecently(studentId, flagType) {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const existing = await prisma.flag.findFirst({
    where: { studentId, flagType, createdAt: { gte: sevenDaysAgo } },
  });
  return !!existing;
}

// ------------------------------------------------------------------
// POST /flags/run-attendance-check — admin-triggered
// ------------------------------------------------------------------
router.post('/flags/run-attendance-check', requireAuth, requireRole('admin'), async (req, res) => {
  const thresholds = await getThresholds();
  const students = await prisma.student.findMany({ where: { status: 'active' } });

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const flagsCreated = [];

  for (const student of students) {
    const records = await prisma.attendanceRecord.findMany({
      where: { studentId: student.id, date: { gte: thirtyDaysAgo } },
    });

    if (records.length === 0) continue;

    const absences = records.filter((r) => r.status === 'absent').length;
    const rate = (records.length - absences) / records.length;

    const triggeredByCount = absences >= thresholds.attendanceAbsenceThreshold;
    const triggeredByRate = rate < thresholds.attendanceRateThreshold;

    if (triggeredByCount || triggeredByRate) {
      const alreadyFlagged = await alreadyFlaggedRecently(student.id, 'attendance');
      if (!alreadyFlagged) {
        const flag = await prisma.flag.create({
          data: {
            studentId: student.id,
            flagType: 'attendance',
            message: `${absences} absences in the last 30 days (${Math.round(rate * 100)}% attendance rate).`,
          },
        });
        flagsCreated.push(flag);
      }
    }
  }

  res.json({ success: true, flagsCreated: flagsCreated.length, flags: flagsCreated });
});

// ------------------------------------------------------------------
// POST /flags/run-performance-check — admin-triggered
// Body: { currentTerm, previousTerm }
// ------------------------------------------------------------------
router.post('/flags/run-performance-check', requireAuth, requireRole('admin'), async (req, res) => {
  const { currentTerm, previousTerm } = req.body;
  if (!currentTerm) {
    return res.status(400).json({ error: 'currentTerm is required' });
  }

  const thresholds = await getThresholds();
  const students = await prisma.student.findMany({ where: { status: 'active' } });

  const flagsCreated = [];

  for (const student of students) {
    const current = await prisma.resultPublication.findUnique({
      where: { studentId_term: { studentId: student.id, term: currentTerm } },
    });
    if (!current || current.average === null) continue;

    // Consistently low check (absolute threshold)
    if (current.average < thresholds.performanceLowThreshold) {
      const alreadyFlagged = await alreadyFlaggedRecently(student.id, 'performance_low');
      if (!alreadyFlagged) {
        const flag = await prisma.flag.create({
          data: {
            studentId: student.id,
            flagType: 'performance_low',
            message: `Average of ${current.average.toFixed(1)} is below the school's floor of ${thresholds.performanceLowThreshold}.`,
          },
        });
        flagsCreated.push(flag);
      }
    }

    // Declining check (needs a previous term to compare against)
    if (previousTerm) {
      const previous = await prisma.resultPublication.findUnique({
        where: { studentId_term: { studentId: student.id, term: previousTerm } },
      });
      if (previous && previous.average !== null) {
        const drop = previous.average - current.average;
        if (drop >= thresholds.performanceDeclineThreshold) {
          const alreadyFlagged = await alreadyFlaggedRecently(student.id, 'performance_declining');
          if (!alreadyFlagged) {
            const flag = await prisma.flag.create({
              data: {
                studentId: student.id,
                flagType: 'performance_declining',
                message: `Average dropped from ${previous.average.toFixed(1)} to ${current.average.toFixed(1)} (${drop.toFixed(1)} point drop).`,
              },
            });
            flagsCreated.push(flag);
          }
        }
      }
    }
  }

  res.json({ success: true, flagsCreated: flagsCreated.length, flags: flagsCreated });
});

// ------------------------------------------------------------------
// GET /flags?studentId=xxx — view flags for one student
// ------------------------------------------------------------------
router.get('/flags', requireAuth, requireRole('admin', 'teacher'), async (req, res) => {
  const { studentId } = req.query;
  if (!studentId) return res.status(400).json({ error: 'studentId query param is required' });

  const flags = await prisma.flag.findMany({
    where: { studentId },
    orderBy: { createdAt: 'desc' },
  });
  res.json(flags);
});

// ------------------------------------------------------------------
// GET /flags/class/:classId — every flag for every student in a class
// ------------------------------------------------------------------
router.get('/flags/class/:classId', requireAuth, requireRole('admin', 'teacher'), async (req, res) => {
  const students = await prisma.student.findMany({
    where: { classId: req.params.classId, status: 'active' },
  });
  const studentIds = students.map((s) => s.id);

  const flags = await prisma.flag.findMany({
    where: { studentId: { in: studentIds } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(flags);
});

module.exports = router;
