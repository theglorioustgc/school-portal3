// auth.js
//
// Handles:
//  - POST /auth/login          -> one field "identifier" (ID or email), auto-detected
//  - POST /auth/register/student  (admin only)
//  - POST /auth/register/teacher  (admin only)
//
// LOGIN DETECTION RULE (agreed):
//  - contains "@"                -> email -> check AdminUser, then BursarUser
//  - matches "-STF-" in the ID   -> Teacher table
//  - otherwise matches ID shape  -> Student table
//  - matches nothing             -> generic invalid error (never reveal which part failed)

const express = require('express');
const jwt = require('jsonwebtoken');
const prisma = require('../db');
const { generateId } = require('../utils/idGenerator');
const { generateTempPassword, hashPassword, verifyPassword } = require('../utils/password');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
const ID_PATTERN = /^[A-Z0-9]+-(STF-)?\d{4}-\d{4}$/i; // e.g. GHS-2024-0089 or GHS-STF-2024-0012

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });
}

// ------------------------------------------------------------------
// LOGIN — single endpoint, single "identifier" field for everyone
// ------------------------------------------------------------------
router.post('/login', async (req, res) => {
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    return res.status(400).json({ error: 'Invalid ID/email or password' });
  }

  const GENERIC_ERROR = { error: 'Invalid ID/email or password' };

  try {
    // --- Email shape -> Admin or Bursar ---
    if (identifier.includes('@')) {
      const admin = await prisma.adminUser.findUnique({ where: { email: identifier.toLowerCase() } });
      if (admin && (await verifyPassword(password, admin.passwordHash))) {
        return res.json({
          token: signToken({ id: admin.id, role: 'admin' }),
          role: 'admin',
        });
      }

      const bursar = await prisma.bursarUser.findUnique({ where: { email: identifier.toLowerCase() } });
      if (bursar && (await verifyPassword(password, bursar.passwordHash))) {
        return res.json({
          token: signToken({ id: bursar.id, role: 'bursar' }),
          role: 'bursar',
        });
      }

      return res.status(401).json(GENERIC_ERROR);
    }

    // --- ID shape -> Student or Teacher ---
    const normalizedId = identifier.trim().toUpperCase();

    if (!ID_PATTERN.test(normalizedId)) {
      return res.status(401).json(GENERIC_ERROR);
    }

    if (normalizedId.includes('-STF-')) {
      const teacher = await prisma.teacher.findUnique({ where: { teacherId: normalizedId } });
      if (teacher && (await verifyPassword(password, teacher.passwordHash))) {
        return res.json({
          token: signToken({ id: teacher.id, role: 'teacher' }),
          role: 'teacher',
          mustChangePassword: teacher.mustChangePassword,
        });
      }
      return res.status(401).json(GENERIC_ERROR);
    }

    const student = await prisma.student.findUnique({ where: { studentId: normalizedId } });
    if (student && (await verifyPassword(password, student.passwordHash))) {
      return res.json({
        token: signToken({ id: student.id, role: 'student' }),
        role: 'student',
        mustChangePassword: student.mustChangePassword,
      });
    }

    return res.status(401).json(GENERIC_ERROR);
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ------------------------------------------------------------------
// REGISTER STUDENT — admin only. Generates ID + temp password.
// (Notification/email sending is wired in once the alerts module exists —
//  left as a TODO hook here so this file stays focused on auth.)
// ------------------------------------------------------------------
router.post('/register/student', requireAuth, requireRole('admin'), async (req, res) => {
  const { firstName, lastName, classId, parentEmail, parentPhone, schoolCode } = req.body;

  if (!firstName || !lastName || !schoolCode) {
    return res.status(400).json({ error: 'firstName, lastName, and schoolCode are required' });
  }

  const admissionYear = new Date().getFullYear();
  const studentId = await generateId('STUDENT', admissionYear, schoolCode);
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  const student = await prisma.student.create({
    data: {
      studentId,
      firstName,
      lastName,
      admissionYear,
      classId: classId || null,
      parentEmail,
      parentPhone,
      passwordHash,
      mustChangePassword: true,
    },
  });

  // TODO: sendNotification(parentEmail/parentPhone, `Student ID: ${studentId}, Temp password: ${tempPassword}`)

  return res.status(201).json({
    id: student.id,
    studentId: student.studentId,
    tempPassword, // returned once so admin can relay it; not stored in plain text anywhere
  });
});

// ------------------------------------------------------------------
// REGISTER TEACHER — admin only. Same pattern as student.
// ------------------------------------------------------------------
router.post('/register/teacher', requireAuth, requireRole('admin'), async (req, res) => {
  const { firstName, lastName, email, phone, schoolCode } = req.body;

  if (!firstName || !lastName || !schoolCode) {
    return res.status(400).json({ error: 'firstName, lastName, and schoolCode are required' });
  }

  const joinYear = new Date().getFullYear();
  const teacherId = await generateId('STAFF', joinYear, schoolCode);
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  const teacher = await prisma.teacher.create({
    data: {
      teacherId,
      firstName,
      lastName,
      joinYear,
      email,
      phone,
      passwordHash,
      mustChangePassword: true,
    },
  });

  // TODO: sendNotification(email, `Teacher ID: ${teacherId}, Temp password: ${tempPassword}`)

  return res.status(201).json({
    id: teacher.id,
    teacherId: teacher.teacherId,
    tempPassword,
  });
});

// ------------------------------------------------------------------
// CHANGE PASSWORD — forces the mustChangePassword flow on first login
// ------------------------------------------------------------------
router.post('/change-password', requireAuth, async (req, res) => {
  const { newPassword } = req.body;
  const { id, role } = req.user;

  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const passwordHash = await hashPassword(newPassword);

  if (role === 'student') {
    await prisma.student.update({ where: { id }, data: { passwordHash, mustChangePassword: false } });
  } else if (role === 'teacher') {
    await prisma.teacher.update({ where: { id }, data: { passwordHash, mustChangePassword: false } });
  } else {
    return res.status(400).json({ error: 'Password change not applicable for this role here' });
  }

  return res.json({ success: true });
});

// ------------------------------------------------------------------
   // GET /auth/me — the logged-in user's own basic profile.
   // Works for any role; shape differs slightly since roles differ.
   // ------------------------------------------------------------------
   router.get('/me', requireAuth, async (req, res) => {
     const { id, role } = req.user;

     if (role === 'student') {
       const student = await prisma.student.findUnique({ where: { id }, include: { class: true } });
       return res.json({ role, firstName: student.firstName, lastName: student.lastName, classId: student.classId, className: student.class?.name || null });
     }
     if (role === 'teacher') {
       const teacher = await prisma.teacher.findUnique({ where: { id } });
       return res.json({ role, firstName: teacher.firstName, lastName: teacher.lastName });
     }
     if (role === 'admin') {
       const admin = await prisma.adminUser.findUnique({ where: { id } });
       return res.json({ role, firstName: admin.firstName, lastName: admin.lastName });
     }
     if (role === 'bursar') {
       const bursar = await prisma.bursarUser.findUnique({ where: { id } });
       return res.json({ role, firstName: bursar.firstName, lastName: bursar.lastName });
     }
     res.status(400).json({ error: 'Unknown role' });
   });
module.exports = router;
