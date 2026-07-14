// fees.js
//
// Fully hands-off from real payment processing — this system never
// touches money. Admin/bursar just toggle a status after checking the
// school's actual payment provider (e.g. Remita) themselves.
// Every "mark paid" action is logged with who did it and when.

const express = require('express');
const prisma = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendAlert } = require('../utils/notify');

const router = express.Router();

// ------------------------------------------------------------------
// FEE TYPES
// ------------------------------------------------------------------

// classId query param optional — if given, returns fee types that
   // either apply to every class (no links) OR are specifically linked
   // to that class.
   router.get('/fee-types', requireAuth, requireRole('admin', 'bursar'), async (req, res) => {
     const { classId } = req.query;

     const feeTypes = await prisma.feeType.findMany({
       where: classId
         ? { OR: [{ classes: { none: {} } }, { classes: { some: { classId } } }] }
         : {},
       include: { classes: { include: { class: true } } },
       orderBy: { createdAt: 'desc' },
     });
     res.json(feeTypes);
   });

   // Body: { name, amount, term, classIds? }
   // classIds omitted or empty -> applies to every class
   router.post('/fee-types', requireAuth, requireRole('admin'), async (req, res) => {
     const { name, amount, term, classIds } = req.body;
     if (!name) return res.status(400).json({ error: 'name is required' });

     const feeType = await prisma.feeType.create({ data: { name, amount, term } });

     if (Array.isArray(classIds) && classIds.length > 0) {
       await prisma.feeTypeClass.createMany({
         data: classIds.map((classId) => ({ feeTypeId: feeType.id, classId })),
       });
     }

     const result = await prisma.feeType.findUnique({
       where: { id: feeType.id },
       include: { classes: { include: { class: true } } },
     });
     res.status(201).json(result);
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

     if (status === 'paid') {
       const student = await prisma.student.findUnique({ where: { id: studentId } });
       const feeType = await prisma.feeType.findUnique({ where: { id: feeTypeId } });
       if (student?.parentEmail) {
         await sendAlert({
           recipient: student.parentEmail,
           channel: 'email',
           message: `Payment confirmed: "${feeType?.name || 'a fee'}" has been marked as paid for ${student.firstName}.`,
           triggerType: 'fee_status',
         });
       }
     }

     res.json(record);
   });

module.exports = router;
