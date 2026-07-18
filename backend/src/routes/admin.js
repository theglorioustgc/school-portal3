// admin.js
//
// Three admin-only tools bundled together:
//  - Documents: label + link, browsable, separate from academic data
//  - Alumni transfer: flips Student.status, never deletes anything
//  - Content/CMS: news/facts posts shown on the student dashboard

const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
// ------------------------------------------------------------------
// STUDENT & TEACHER DIRECTORY — powers the admin dashboard's
// at-a-glance numbers and search.
// ------------------------------------------------------------------
router.get('/students', requireAuth, requireRole('admin', 'teacher'), async (req, res) => {
     const { search, classId } = req.query;
     const where = { status: 'active' };

     if (req.user.role === 'teacher') {
       // Teachers can only ever list students in a class they're actually assigned to
       if (!classId) return res.status(400).json({ error: 'classId is required for teachers' });
       const assignment = await prisma.teacherAssignment.findFirst({
         where: { teacherId: req.user.id, classId },
       });
       if (!assignment) return res.status(403).json({ error: 'You are not assigned to this class' });
     }

     if (classId) where.classId = classId;
  if (search) {
    where.OR = [
      { firstName: { contains: search, mode: 'insensitive' } },
      { lastName: { contains: search, mode: 'insensitive' } },
      { studentId: { contains: search, mode: 'insensitive' } },
    ];
  }
  const students = await prisma.student.findMany({
    where,
    include: { class: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(students);
});

router.get('/teachers', requireAuth, requireRole('admin'), async (req, res) => {
  const { search } = req.query;
  const where = {};
  if (search) {
    where.OR = [
      { firstName: { contains: search, mode: 'insensitive' } },
      { lastName: { contains: search, mode: 'insensitive' } },
      { teacherId: { contains: search, mode: 'insensitive' } },
    ];
  }
  const teachers = await prisma.teacher.findMany({ where, orderBy: { createdAt: 'desc' } });
  res.json(teachers);
});

// ------------------------------------------------------------------
// DOCUMENTS
// ------------------------------------------------------------------
router.post('/documents', requireAuth, requireRole('admin'), async (req, res) => {
  const { label, category, fileUrl } = req.body;
  if (!label || !category || !fileUrl) {
    return res.status(400).json({ error: 'label, category, and fileUrl are required' });
  }

  const doc = await prisma.document.create({
    data: { label, category, fileUrl, uploadedById: req.user.id },
  });
  res.status(201).json(doc);
});

router.get('/documents', requireAuth, requireRole('admin'), async (req, res) => {
  const { category } = req.query;
  const where = category ? { category } : {};
  const docs = await prisma.document.findMany({ where, orderBy: { createdAt: 'desc' } });
  res.json(docs);
});

router.delete('/documents/:id', requireAuth, requireRole('admin'), async (req, res) => {
  await prisma.document.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// ------------------------------------------------------------------
// ALUMNI TRANSFER — flips status, never deletes. Removes them from
// active rosters (any query filtering status:'active' naturally
// excludes them) while keeping them fully searchable here.
// ------------------------------------------------------------------
router.post('/students/:id/transfer-alumni', requireAuth, requireRole('admin'), async (req, res) => {
  const { reason } = req.body;
  const student = await prisma.student.update({
    where: { id: req.params.id },
    data: { status: 'alumni', leftDate: new Date(), leftReason: reason || null },
  });
  res.json(student);
});

router.get('/alumni', requireAuth, requireRole('admin'), async (req, res) => {
  const alumni = await prisma.student.findMany({
    where: { status: 'alumni' },
    orderBy: { leftDate: 'desc' },
  });
  res.json(alumni);
});

// ------------------------------------------------------------------
// CONTENT / CMS
// ------------------------------------------------------------------
router.post('/content', requireAuth, requireRole('admin'), async (req, res) => {
  const { title, body, imageUrl, category, published } = req.body;
  if (!title || !body) {
    return res.status(400).json({ error: 'title and body are required' });
  }

  const post = await prisma.contentPost.create({
    data: { title, body, imageUrl, category, published: !!published, postedById: req.user.id },
  });
  res.status(201).json(post);
});

// Students/teachers see only published posts; admin sees everything
// Public — no login required, so the homepage can show real news.
   // Logged-in admin still sees everything (including unpublished);
   // everyone else (including logged-out visitors) sees published only.
   router.get('/content', async (req, res) => {
     const authHeader = req.headers.authorization;
     let isAdmin = false;

     if (authHeader) {
       try {
         const jwt = require('jsonwebtoken');
         const payload = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
         isAdmin = payload.role === 'admin';
       } catch (err) {
         // invalid/expired token — just treat as a logged-out visitor
       }
     }

     const where = isAdmin ? {} : { published: true };
     const posts = await prisma.contentPost.findMany({ where, orderBy: { createdAt: 'desc' } });
     res.json(posts);
   });

router.patch('/content/:id/publish', requireAuth, requireRole('admin'), async (req, res) => {
  const { published } = req.body;
  const post = await prisma.contentPost.update({
    where: { id: req.params.id },
    data: { published: !!published },
  });
  res.json(post);
});

router.delete('/content/:id', requireAuth, requireRole('admin'), async (req, res) => {
  await prisma.contentPost.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

module.exports = router;
