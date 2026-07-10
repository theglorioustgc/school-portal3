// assignments.js
//
// Teacher posts an assignment to a class+subject they're assigned to
// (same permission check pattern as gradebook). Students in that class
// can view it and submit a link. A student can only submit to their
// own class's assignments — enforced by checking their classId matches.

const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

async function canPostToClassSubject(user, classId, subjectId) {
  if (user.role === 'admin') return true;
  if (user.role !== 'teacher') return false;

  const assignment = await prisma.teacherAssignment.findFirst({
    where: { teacherId: user.id, classId, subjectId },
  });
  return !!assignment;
}

// ------------------------------------------------------------------
// POST /assignments -> post a new assignment
// Body: { title, description, linkUrl?, dueDate, classId, subjectId }
// ------------------------------------------------------------------
router.post('/assignments', requireAuth, requireRole('admin', 'teacher'), async (req, res) => {
  const { title, description, linkUrl, dueDate, classId, subjectId } = req.body;

  if (!title || !description || !dueDate || !classId || !subjectId) {
    return res.status(400).json({ error: 'title, description, dueDate, classId, and subjectId are required' });
  }

  const allowed = await canPostToClassSubject(req.user, classId, subjectId);
  if (!allowed) {
    return res.status(403).json({ error: 'You are not assigned to teach this subject for this class' });
  }

  // Admin posting directly needs a teacher on record to attribute it to —
  // for now we require admin to also pass a postedById; otherwise use req.user.id
  const postedById = req.user.role === 'teacher' ? req.user.id : req.body.postedById;
  if (!postedById) {
    return res.status(400).json({ error: 'postedById is required when an admin posts on behalf of a teacher' });
  }

  const assignment = await prisma.assignment.create({
    data: { title, description, linkUrl, dueDate: new Date(dueDate), classId, subjectId, postedById },
  });

  res.status(201).json(assignment);
});

// ------------------------------------------------------------------
// GET /assignments?classId=xxx -> list assignments for a class
// (students use their own classId; teachers/admin can query any)
// ------------------------------------------------------------------
router.get('/assignments', requireAuth, async (req, res) => {
  let { classId } = req.query;

  if (req.user.role === 'student' && !classId) {
    const student = await prisma.student.findUnique({ where: { id: req.user.id } });
    classId = student.classId;
  }

  if (!classId) {
    return res.status(400).json({ error: 'classId query param is required' });
  }

  const assignments = await prisma.assignment.findMany({
    where: { classId },
    include: { subject: true, postedBy: true },
    orderBy: { dueDate: 'asc' },
  });

  res.json(assignments);
});

// ------------------------------------------------------------------
// POST /assignments/:id/submit -> student submits a link
// Body: { linkUrl }
// ------------------------------------------------------------------
router.post('/assignments/:id/submit', requireAuth, requireRole('student'), async (req, res) => {
  const { linkUrl } = req.body;
  const { id: assignmentId } = req.params;

  if (!linkUrl) {
    return res.status(400).json({ error: 'linkUrl is required' });
  }

  const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } });
  if (!assignment) {
    return res.status(404).json({ error: 'Assignment not found' });
  }

  const student = await prisma.student.findUnique({ where: { id: req.user.id } });
  if (student.classId !== assignment.classId) {
    return res.status(403).json({ error: 'This assignment is not for your class' });
  }

  const submission = await prisma.assignmentSubmission.upsert({
    where: { assignmentId_studentId: { assignmentId, studentId: req.user.id } },
    update: { linkUrl, submittedAt: new Date() },
    create: { assignmentId, studentId: req.user.id, linkUrl },
  });

  res.status(201).json(submission);
});

// ------------------------------------------------------------------
// GET /assignments/:id/submissions -> teacher/admin views all submissions
// ------------------------------------------------------------------
router.get('/assignments/:id/submissions', requireAuth, requireRole('admin', 'teacher'), async (req, res) => {
  const submissions = await prisma.assignmentSubmission.findMany({
    where: { assignmentId: req.params.id },
    include: { student: true },
  });
  res.json(submissions);
});

module.exports = router;
