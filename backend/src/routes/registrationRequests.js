// registrationRequests.js
//
// Public, no-login submission from a parent, sitting in a review
// queue until an admin approves it. Approval reuses the exact same
// ID-generation and temp-password logic as admin's direct
// registration endpoint, so an approved request becomes a fully
// real student account with real login credentials.

const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { generateId } = require('../utils/idGenerator');
const { generateTempPassword, hashPassword } = require('../utils/password');
const { sendAlert } = require('../utils/notify');

const router = express.Router();

// ------------------------------------------------------------------
// PUBLIC — no auth. A parent submits their child's details.
// ------------------------------------------------------------------
router.post('/public/register-request', async (req, res) => {
  const { firstName, lastName, dob, desiredClassId, parentName, parentEmail, parentPhone } = req.body;

  if (!firstName || !lastName || !parentName || !parentEmail) {
    return res.status(400).json({ error: 'firstName, lastName, parentName, and parentEmail are required' });
  }

  const request = await prisma.registrationRequest.create({
    data: {
      firstName, lastName,
      dob: dob ? new Date(dob) : null,
      desiredClassId: desiredClassId || null,
      parentName, parentEmail, parentPhone,
    },
  });

  res.status(201).json({ success: true, message: 'Your registration request has been received. The school will contact you once it has been reviewed.' });
});

// ------------------------------------------------------------------
// ADMIN — review queue
// ------------------------------------------------------------------
router.get('/registration-requests', requireAuth, requireRole('admin'), async (req, res) => {
  const { status } = req.query;
  const requests = await prisma.registrationRequest.findMany({
    where: status ? { status } : {},
    include: { desiredClass: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(requests);
});

// Approve -> creates a real Student account, same mechanism as
// admin's direct registration endpoint.
router.post('/registration-requests/:id/approve', requireAuth, requireRole('admin'), async (req, res) => {
  const { classId, schoolCode } = req.body;
  if (!schoolCode) return res.status(400).json({ error: 'schoolCode is required' });

  const request = await prisma.registrationRequest.findUnique({ where: { id: req.params.id } });
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.status !== 'pending') return res.status(409).json({ error: 'This request has already been reviewed' });

  const finalClassId = classId || request.desiredClassId || null;
  const admissionYear = new Date().getFullYear();
  const studentId = await generateId('STUDENT', admissionYear, schoolCode);
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  const student = await prisma.student.create({
    data: {
      studentId,
      firstName: request.firstName,
      lastName: request.lastName,
      admissionYear,
      classId: finalClassId,
      parentEmail: request.parentEmail,
      parentPhone: request.parentPhone,
      passwordHash,
      mustChangePassword: true,
    },
  });

  await prisma.registrationRequest.update({
    where: { id: request.id },
    data: { status: 'approved', reviewedById: req.user.id, approvedStudentId: student.id },
  });

  await sendAlert({
    recipient: request.parentEmail,
    channel: 'email',
    message: `${request.firstName}'s registration has been approved. Login ID: ${studentId}, Temporary password: ${tempPassword}`,
    triggerType: 'registration_approved',
  });

  res.json({ studentId: student.studentId, tempPassword });
});

router.post('/registration-requests/:id/reject', requireAuth, requireRole('admin'), async (req, res) => {
  const { reviewNote } = req.body;
  const request = await prisma.registrationRequest.update({
    where: { id: req.params.id },
    data: { status: 'rejected', reviewedById: req.user.id, reviewNote: reviewNote || null },
  });
  res.json(request);
});

module.exports = router;
