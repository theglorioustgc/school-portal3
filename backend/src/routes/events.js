// events.js
//
// School calendar, audience-scoped same as announcements.
// POST /events/send-reminders is meant to be called once a day by
// a scheduled job (we'll wire up the actual scheduler once this is
// confirmed working) — it finds events happening tomorrow that
// haven't had a reminder sent yet, and sends one via notify.js.

const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendAlert } = require('../utils/notify');

const router = express.Router();

const VALID_AUDIENCES = ['all', 'teachers', 'students', 'class'];

// ------------------------------------------------------------------
// POST /events -> create an event
// ------------------------------------------------------------------
router.post('/events', requireAuth, requireRole('admin', 'teacher'), async (req, res) => {
  const { title, description, eventDate, audience, classId } = req.body;

  if (!title || !eventDate || !VALID_AUDIENCES.includes(audience)) {
    return res.status(400).json({ error: 'title, eventDate, and a valid audience are required' });
  }

  if (req.user.role === 'teacher') {
    if (audience !== 'class') {
      return res.status(403).json({ error: 'Teachers can only create class-scoped events' });
    }
    const assignment = await prisma.teacherAssignment.findFirst({
      where: { teacherId: req.user.id, classId },
    });
    if (!assignment) {
      return res.status(403).json({ error: 'You are not assigned to this class' });
    }
  }

  const event = await prisma.event.create({
    data: {
      title,
      description,
      eventDate: new Date(eventDate),
      audience,
      classId: audience === 'class' ? classId : null,
      createdByAdminId: req.user.role === 'admin' ? req.user.id : null,
      createdByTeacherId: req.user.role === 'teacher' ? req.user.id : null,
    },
  });

  res.status(201).json(event);
});

// ------------------------------------------------------------------
// GET /events -> feed relevant to the logged-in user (same pattern as announcements)
// ------------------------------------------------------------------
router.get('/events', requireAuth, async (req, res) => {
  const { role, id } = req.user;

  if (role === 'admin') {
    return res.json(await prisma.event.findMany({ orderBy: { eventDate: 'asc' } }));
  }

  if (role === 'teacher') {
    const feed = await prisma.event.findMany({
      where: { OR: [{ audience: 'all' }, { audience: 'teachers' }, { audience: 'class', createdByTeacherId: id }] },
      orderBy: { eventDate: 'asc' },
    });
    return res.json(feed);
  }

  if (role === 'student') {
    const student = await prisma.student.findUnique({ where: { id } });
    const feed = await prisma.event.findMany({
      where: { OR: [{ audience: 'all' }, { audience: 'students' }, { audience: 'class', classId: student.classId }] },
      orderBy: { eventDate: 'asc' },
    });
    return res.json(feed);
  }

  res.json(await prisma.event.findMany({ where: { audience: 'all' }, orderBy: { eventDate: 'asc' } }));
});

// ------------------------------------------------------------------
// POST /events/send-reminders -> admin-triggered for now (manual test);
// finds events happening tomorrow with no reminder sent yet, and sends one
// to every student in scope via their parentEmail.
// ------------------------------------------------------------------
router.post('/events/send-reminders', requireAuth, requireRole('admin'), async (req, res) => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const startOfDay = new Date(tomorrow.setHours(0, 0, 0, 0));
  const endOfDay = new Date(tomorrow.setHours(23, 59, 59, 999));

  const upcomingEvents = await prisma.event.findMany({
    where: { eventDate: { gte: startOfDay, lte: endOfDay }, reminderSent: false },
  });

  let alertsSent = 0;

  for (const event of upcomingEvents) {
    let students = [];

    if (event.audience === 'all' || event.audience === 'students') {
      students = await prisma.student.findMany({ where: { status: 'active' } });
    } else if (event.audience === 'class' && event.classId) {
      students = await prisma.student.findMany({ where: { classId: event.classId, status: 'active' } });
    }

    for (const student of students) {
      if (student.parentEmail) {
        await sendAlert({
          recipient: student.parentEmail,
          channel: 'email',
          message: `Reminder: "${event.title}" is happening tomorrow.`,
          triggerType: 'event_reminder',
        });
        alertsSent++;
      }
    }

    await prisma.event.update({ where: { id: event.id }, data: { reminderSent: true } });
  }

  res.json({ eventsProcessed: upcomingEvents.length, alertsSent });
});

module.exports = router;
