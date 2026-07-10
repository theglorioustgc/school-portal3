// fees.js
//
// Fully hands-off from real payment processing — this system never
// touches money. Admin/bursar just toggle a status after checking the
// school's actual payment provider (e.g. Remita) themselves.
// Every "mark paid" action is logged with who did it and when.

const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// ------------------------------------------------------------------
// FEE TYPES
// ------------------------------------------------------------------

router.get('/fee-types', requireAuth, requireRole('admin', 'bursar'), async (req, res) => {
  const feeTypes = await prisma.feeType.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(feeTypes);
});

router.post('/fee-types', requireAuth, requireRole('admin'), async (req, res) => {
  const { name, amount, term } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const feeType = await prisma.feeType.create({ data: { name, amount, term } });
  res.status(201).json(feeType);
});

// ------------------------------------------------------------------
// GET /fees/class/:classId?feeTypeId=xxx
// -> every student in a class, with their paid/pending status for one fee type
// (creates a "pending" row on the fly for any student who doesn't have one yet,
// so the list is always complete without needing to pre-seed every student)
// ------------------------------------------------------------------
router.get('/fees/class/:classId', requireAuth, requireRole('admin', 'bursar'), async (req, res) => {
  const { classId } = req.params;
  const { feeTypeId } = req.query;

  if (!feeTypeId) return res.status(400).json({ error: 'feeTypeId query param is required' });

  const students = await prisma.student.findMany({
    where: { classId, status: 'active' },
    include: {
      feePayments: { where: { feeTypeId } },
    },
  });

  const result = students.map((s) => ({
    studentId: s.id,
    studentDisplayId: s.studentId,
    firstName: s.firstName,
    lastName: s.lastName,
    status: s.feePayments[0]?.status || 'pending',
    markedPaidAt: s.feePayments[0]?.markedPaidAt || null,
  }));

  const paidCount = result.filter((r) => r.status === 'paid').length;

  res.json({ students: result, paidCount, totalCount: result.length });
});

// ------------------------------------------------------------------
// POST /fees/mark -> toggle one student's fee status
// Body: { studentId, feeTypeId, status: "paid" | "pending" }
// ------------------------------------------------------------------
router.post('/fees/mark', requireAuth, requireRole('admin', 'bursar'), async (req, res) => {
  const { studentId, feeTypeId, status } = req.body;

  if (!studentId || !feeTypeId || !['paid', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'studentId, feeTypeId, and a valid status (paid/pending) are required' });
  }

  const markedPaidByAdminId = req.user.role === 'admin' ? req.user.id : null;
  const markedPaidByBursarId = req.user.role === 'bursar' ? req.user.id : null;

  const record = await prisma.studentFeePayment.upsert({
    where: { studentId_feeTypeId: { studentId, feeTypeId } },
    update: {
      status,
      markedPaidByAdminId: status === 'paid' ? markedPaidByAdminId : null,
      markedPaidByBursarId: status === 'paid' ? markedPaidByBursarId : null,
      markedPaidAt: status === 'paid' ? new Date() : null,
    },
    create: {
      studentId,
      feeTypeId,
      status,
      markedPaidByAdminId: status === 'paid' ? markedPaidByAdminId : null,
      markedPaidByBursarId: status === 'paid' ? markedPaidByBursarId : null,
      markedPaidAt: status === 'paid' ? new Date() : null,
    },
  });

  res.json(record);
});

module.exports = router;
