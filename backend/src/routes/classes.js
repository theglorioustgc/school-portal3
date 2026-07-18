// classes.js
//
// Manages the shared reference data everything else depends on:
// SchoolClass, Subject, and TeacherAssignment (who teaches what to whom).
// All routes here are admin-only, since this is setup/configuration data,
// not something teachers or students edit themselves.

const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// ------------------------------------------------------------------
// CLASSES
// ------------------------------------------------------------------

// List all classes
// List all classes — public, no login required, so the public
   // application form (apply.html) can populate its class dropdown.
   router.get('/classes', async (req, res) => {
     const classes = await prisma.schoolClass.findMany({ orderBy: { name: 'asc' } });
     res.json(classes);
   });

// Create a class
router.post('/classes', requireAuth, requireRole('admin'), async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const existing = await prisma.schoolClass.findUnique({ where: { name } });
  if (existing) return res.status(409).json({ error: 'A class with this name already exists' });

  const schoolClass = await prisma.schoolClass.create({ data: { name } });
  res.status(201).json(schoolClass);
});

// Delete a class
router.delete('/classes/:id', requireAuth, requireRole('admin'), async (req, res) => {
  await prisma.schoolClass.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// ------------------------------------------------------------------
// SUBJECTS
// ------------------------------------------------------------------

// List all subjects
router.get('/subjects', requireAuth, async (req, res) => {
  const subjects = await prisma.subject.findMany({ orderBy: { name: 'asc' } });
  res.json(subjects);
});

// Create a subject
router.post('/subjects', requireAuth, requireRole('admin'), async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const existing = await prisma.subject.findUnique({ where: { name } });
  if (existing) return res.status(409).json({ error: 'A subject with this name already exists' });

  const subject = await prisma.subject.create({ data: { name } });
  res.status(201).json(subject);
});

// Delete a subject
router.delete('/subjects/:id', requireAuth, requireRole('admin'), async (req, res) => {
  await prisma.subject.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// ------------------------------------------------------------------
// TEACHER ASSIGNMENTS — the gatekeeper table.
// Every future module (timetable, gradebook, attendance) checks
// this before letting a teacher act on a class/subject.
// ------------------------------------------------------------------

// List all assignments (optionally filtered by teacher)
router.get('/teacher-assignments', requireAuth, async (req, res) => {
  const { teacherId } = req.query;
  const where = teacherId ? { teacherId } : {};

  const assignments = await prisma.teacherAssignment.findMany({
    where,
    include: { teacher: true, class: true, subject: true },
  });
  res.json(assignments);
});

// Create an assignment (link a teacher to a class + subject)
router.post('/teacher-assignments', requireAuth, requireRole('admin'), async (req, res) => {
  const { teacherId, classId, subjectId } = req.body;
  if (!teacherId || !classId || !subjectId) {
    return res.status(400).json({ error: 'teacherId, classId, and subjectId are all required' });
  }

  const existing = await prisma.teacherAssignment.findUnique({
    where: { teacherId_classId_subjectId: { teacherId, classId, subjectId } },
  });
  if (existing) return res.status(409).json({ error: 'This assignment already exists' });

  const assignment = await prisma.teacherAssignment.create({
    data: { teacherId, classId, subjectId },
  });
  res.status(201).json(assignment);
});

// Remove an assignment
router.delete('/teacher-assignments/:id', requireAuth, requireRole('admin'), async (req, res) => {
  await prisma.teacherAssignment.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

module.exports = router;
