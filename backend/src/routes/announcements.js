// announcements.js
//
// Audience-scoped announcements:
//   "all"      -> everyone, admin only
//   "teachers" -> all teachers, admin only
//   "students" -> all students, admin only
//   "class"    -> one specific class, admin OR a teacher assigned to that class
//
// A student/teacher's feed is just "give me announcements relevant to me" —
// the GET route below handles that filtering based on who's asking.

const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const VALID_AUDIENCES = ['all', 'teachers', 'students', 'class'];

// ------------------------------------------------------------------
// POST /announcements -> create one
// Body: { title, body, audience, classId? }
// ------------------------------------------------------------------
router.post('/announcements', requireAuth, requireRole('admin', 'teacher'), async (req, res) => {
  const { title, body, audience, classId } = req.body;

  if (!title || !body || !VALID_AUDIENCES.includes(audience)) {
    return res.status(400).json({ error: 'title, body, and a valid audience (all/teachers/students/class) are required' });
  }

  // Teachers can ONLY post to "class", and only a class they're assigned to
  if (req.user.role === 'teacher') {
    if (audience !== 'class') {
      return res.status(403).json({ error: 'Teachers can only post announcements scoped to their own class' });
    }
    if (!classId) {
      return res.status(400).json({ error: 'classId is required for a class-scoped announcement' });
    }
    const assignment = await prisma.teacherAssignment.findFirst({
      where: { teacherId: req.user.id, classId },
    });
    if (!assignment) {
      return res.status(403).json({ error: 'You are not assigned to this class' });
    }
  }

  if (audience === 'class' && !classId) {
    return res.status(400).json({ error: 'classId is required when audience is "class"' });
  }

  const data = {
    title,
    body,
    audience,
    classId: audience === 'class' ? classId : null,
    createdByAdminId: req.user.role === 'admin' ? req.user.id : null,
    createdByTeacherId: req.user.role === 'teacher' ? req.user.id : null,
  };

  const announcement = await prisma.announcement.create({ data });
  res.status(201).json(announcement);
});

// ------------------------------------------------------------------
// GET /announcements -> feed relevant to the logged-in user's role
// (students/teachers see "all" + their own scope; admin sees everything)
// ------------------------------------------------------------------
router.get('/announcements', requireAuth, async (req, res) => {
  const { role, id } = req.user;

  if (role === 'admin') {
    const all = await prisma.announcement.findMany({ orderBy: { createdAt: 'desc' } });
    return res.json(all);
  }

  if (role === 'teacher') {
    const feed = await prisma.announcement.findMany({
      where: {
        OR: [
          { audience: 'all' },
          { audience: 'teachers' },
          { audience: 'class', createdByTeacherId: id }, // their own posts
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    return res.json(feed);
  }

  if (role === 'student') {
    const student = await prisma.student.findUnique({ where: { id } });
    const feed = await prisma.announcement.findMany({
      where: {
        OR: [
          { audience: 'all' },
          { audience: 'students' },
          { audience: 'class', classId: student.classId },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    return res.json(feed);
  }

  // bursar or any other role: just "all" audience
  const feed = await prisma.announcement.findMany({
    where: { audience: 'all' },
    orderBy: { createdAt: 'desc' },
  });
  res.json(feed);
});

// ------------------------------------------------------------------
// DELETE /announcements/:id -> admin only
// ------------------------------------------------------------------
router.delete('/announcements/:id', requireAuth, requireRole('admin'), async (req, res) => {
  await prisma.announcement.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

module.exports = router;
