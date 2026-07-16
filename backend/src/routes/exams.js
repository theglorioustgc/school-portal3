// exams.js
//
// Full exam flow: answer key -> teacher marks scripts (auto-scored
// objective + manual theory) -> submit -> admin compiles the whole
// class (totals, average, class rank) -> principal reviews and
// explicitly publishes -> student/parent can then see it.
//
// Nothing is visible to a student until "published" is set.

const express = require('express');
   const prisma = require('../db');
   const { requireAuth, requireRole } = require('../middleware/auth');
   const { sendAlert } = require('../utils/notify');
   const { lookupGrade } = require('../utils/gradeLookup');

const router = express.Router();

async function canActOnSubject(user, classId, subjectId) {
  if (user.role === 'admin') return true;
  if (user.role !== 'teacher') return false;
  const assignment = await prisma.teacherAssignment.findFirst({
    where: { teacherId: user.id, classId, subjectId },
  });
  return !!assignment;
}

function scoreObjective(studentAnswers, correctAnswers) {
  let score = 0;
  for (let i = 0; i < correctAnswers.length; i++) {
    if (studentAnswers[i] && studentAnswers[i].toUpperCase() === correctAnswers[i].toUpperCase()) {
      score++;
    }
  }
  return score;
}

// ------------------------------------------------------------------
// ANSWER KEY
// ------------------------------------------------------------------
router.post('/exams/answer-key', requireAuth, requireRole('admin', 'teacher'), async (req, res) => {
  const { classId, subjectId, term, answers } = req.body;

  if (!classId || !subjectId || !term || !Array.isArray(answers) || answers.length === 0) {
    return res.status(400).json({ error: 'classId, subjectId, term, and a non-empty answers array are required' });
  }

  const allowed = await canActOnSubject(req.user, classId, subjectId);
  if (!allowed) {
    return res.status(403).json({ error: 'You are not assigned to teach this subject for this class' });
  }

  const key = await prisma.examAnswerKey.upsert({
    where: { classId_subjectId_term: { classId, subjectId, term } },
    update: { answers: JSON.stringify(answers), totalQuestions: answers.length },
    create: { classId, subjectId, term, answers: JSON.stringify(answers), totalQuestions: answers.length },
  });

  res.status(201).json({ ...key, answers: JSON.parse(key.answers) });
});

// ------------------------------------------------------------------
// MARK A SCRIPT — one student, auto-scores objective, saves as draft
// ------------------------------------------------------------------
router.post('/exams/mark', requireAuth, requireRole('admin', 'teacher'), async (req, res) => {
     const { studentId, classId, subjectId, term, objectiveAnswers, theoryScore } = req.body;

     if (!studentId || !classId || !subjectId || !term || !Array.isArray(objectiveAnswers)) {
       return res.status(400).json({ error: 'studentId, classId, subjectId, term, and objectiveAnswers array are required' });
     }

     const allowed = await canActOnSubject(req.user, classId, subjectId);
     if (!allowed) {
       return res.status(403).json({ error: 'You are not assigned to teach this subject for this class' });
     }

     const existing = await prisma.examScript.findUnique({
       where: { studentId_subjectId_term: { studentId, subjectId, term } },
     });
     if (existing && existing.status === 'submitted') {
       return res.status(409).json({ error: 'This script is already submitted and locked. Ask an admin to reopen it.' });
     }

     const key = await prisma.examAnswerKey.findUnique({
       where: { classId_subjectId_term: { classId, subjectId, term } },
     });
     if (!key) {
       return res.status(400).json({ error: 'No answer key exists yet for this class/subject/term. Set that up first.' });
     }

     const correctAnswers = JSON.parse(key.answers);
     const objectiveScore = scoreObjective(objectiveAnswers, correctAnswers);
     const theory = theoryScore || 0;
     const totalScore = objectiveScore + theory;
     const enteredById = req.user.role === 'teacher' ? req.user.id : null;

     const script = await prisma.examScript.upsert({
       where: { studentId_subjectId_term: { studentId, subjectId, term } },
       update: {
         objectiveAnswers: JSON.stringify(objectiveAnswers),
         objectiveScore, theoryScore: theory, totalScore, classId, enteredById, status: 'draft',
       },
       create: {
         studentId, classId, subjectId, term,
         objectiveAnswers: JSON.stringify(objectiveAnswers),
         objectiveScore, theoryScore: theory, totalScore, enteredById, status: 'draft',
       },
     });

     // Push this exam score straight into the gradebook's "exam" field —
     // this is what makes a marked script flow directly into the report
     // card, without the teacher re-typing the score a second time.
     // If that subject's gradebook record is already submitted/locked,
     // we leave it alone rather than silently overwriting locked data.
     const existingGradeRecord = await prisma.gradeRecord.findUnique({
       where: { studentId_subjectId_term: { studentId, subjectId, term } },
     });

     if (!existingGradeRecord || existingGradeRecord.status === 'draft') {
       const ca1 = existingGradeRecord?.ca1 ?? null;
       const ca2 = existingGradeRecord?.ca2 ?? null;
       const ca3 = existingGradeRecord?.ca3 ?? null;
       const total = [ca1, ca2, ca3, totalScore].filter((v) => v !== null && v !== undefined).reduce((sum, v) => sum + v, 0);

       await prisma.gradeRecord.upsert({
         where: { studentId_subjectId_term: { studentId, subjectId, term } },
         update: { exam: totalScore, total, classId, enteredById },
         create: { studentId, classId, subjectId, term, ca1, ca2, ca3, exam: totalScore, total, enteredById },
       });
     }

     res.status(201).json(script);
   });

// ------------------------------------------------------------------
// SUBMIT — locks every draft script for a class+subject+term
// ------------------------------------------------------------------
router.post('/exams/compile-class', requireAuth, requireRole('admin'), async (req, res) => {
     const { classId, term } = req.body;
     if (!classId || !term) {
       return res.status(400).json({ error: 'classId and term are required' });
     }

     const subjectsForClass = await prisma.teacherAssignment.findMany({
       where: { classId },
       select: { subjectId: true },
       distinct: ['subjectId'],
     });
     const subjectsExpected = subjectsForClass.length;

     const students = await prisma.student.findMany({ where: { classId, status: 'active' } });

     const results = [];
     for (const student of students) {
       // Report card now compiles from the gradebook (GradeRecord) —
       // the single place every subject's score ends up, whether typed
       // in directly or pushed there by the exam-marking tool.
       const records = await prisma.gradeRecord.findMany({
         where: { studentId: student.id, classId, term, status: 'submitted' },
       });
       const subjectsSubmitted = records.length;
       const totalScore = records.reduce((sum, r) => sum + (r.total || 0), 0);
       const average = subjectsSubmitted > 0 ? totalScore / subjectsSubmitted : null;

       results.push({ studentId: student.id, totalScore, average, subjectsExpected, subjectsSubmitted });
     }

  // Rank by totalScore descending (dense rank — ties share a position)
  const sorted = [...results].sort((a, b) => b.totalScore - a.totalScore);
  let position = 0;
  let lastScore = null;
  for (const r of sorted) {
    if (r.totalScore !== lastScore) {
      position++;
      lastScore = r.totalScore;
    }
    r.position = position;
  }

  const saved = await Promise.all(
    results.map((r) =>
      prisma.resultPublication.upsert({
        where: { studentId_term: { studentId: r.studentId, term } },
        update: {
          totalScore: r.totalScore, average: r.average, position: r.position,
          subjectsExpected: r.subjectsExpected, subjectsSubmitted: r.subjectsSubmitted,
        },
        create: {
          studentId: r.studentId, term,
          totalScore: r.totalScore, average: r.average, position: r.position,
          subjectsExpected: r.subjectsExpected, subjectsSubmitted: r.subjectsSubmitted,
        },
      })
    )
  );

  res.json({ success: true, compiledCount: saved.length, results: saved });
});

// ------------------------------------------------------------------
// PUBLISH — principal explicitly releases one student's result
// ------------------------------------------------------------------
router.post('/exams/publish', requireAuth, requireRole('admin'), async (req, res) => {
  const { studentId, term } = req.body;
  if (!studentId || !term) {
    return res.status(400).json({ error: 'studentId and term are required' });
  }

  const result = await prisma.resultPublication.update({
    where: { studentId_term: { studentId, term } },
    data: { status: 'published', publishedAt: new Date() },
  });

  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (student?.parentEmail) {
    await sendAlert({
      recipient: student.parentEmail,
      channel: 'email',
      message: `${student.firstName}'s result for ${term} has been published.`,
      triggerType: 'grade_published',
    });
  }

  res.json(result);
});

// ------------------------------------------------------------------
// GET RESULT — students only see it once published; admin/teacher see anytime
// ------------------------------------------------------------------
router.get('/exams/results', requireAuth, async (req, res) => {
  const { studentId, term } = req.query;
  if (!studentId || !term) {
    return res.status(400).json({ error: 'studentId and term query params are required' });
  }

  if (req.user.role === 'student' && req.user.id !== studentId) {
    return res.status(403).json({ error: 'You can only view your own results' });
  }

  const result = await prisma.resultPublication.findUnique({
    where: { studentId_term: { studentId, term } },
  });

  if (!result) return res.status(404).json({ error: 'No compiled result found for this student/term yet' });

  if (req.user.role === 'student' && result.status !== 'published') {
    return res.status(403).json({ error: 'This result has not been published yet' });
  }

  res.json(result);
});

// ------------------------------------------------------------------
   // GET /exams/report-card?studentId=xxx&term=xxx
   // Full printable report card: school info, student info, every
   // submitted subject with CA1/CA2/CA3/Exam/Total/Grade/Remark,
   // overall total/average/position. Same publish-gate as before —
   // students can't see it until the principal has published it.
   // ------------------------------------------------------------------
   router.get('/exams/report-card', requireAuth, async (req, res) => {
     const { studentId, term } = req.query;
     if (!studentId || !term) {
       return res.status(400).json({ error: 'studentId and term query params are required' });
     }

     if (req.user.role === 'student' && req.user.id !== studentId) {
       return res.status(403).json({ error: 'You can only view your own report card' });
     }

     const publication = await prisma.resultPublication.findUnique({
       where: { studentId_term: { studentId, term } },
     });

     if (!publication) {
       return res.status(404).json({ error: 'No compiled result found for this student/term yet' });
     }

     if (req.user.role === 'student' && publication.status !== 'published') {
       return res.status(403).json({ error: 'This report card has not been published yet' });
     }

     const student = await prisma.student.findUnique({ where: { id: studentId }, include: { class: true } });
     const school = await prisma.schoolConfig.findFirst();

     const records = await prisma.gradeRecord.findMany({
       where: { studentId, term, status: 'submitted' },
       include: { subject: true },
       orderBy: { subject: { name: 'asc' } },
     });

     const subjects = [];
     for (const r of records) {
       const { grade, remark } = await lookupGrade(r.total);
       subjects.push({
         subject: r.subject.name,
         ca1: r.ca1, ca2: r.ca2, ca3: r.ca3, exam: r.exam, total: r.total,
         grade, remark,
       });
     }

     const { grade: overallGrade, remark: overallRemark } = await lookupGrade(publication.average);

     res.json({
       school: school ? {
         schoolName: school.schoolName,
         logoUrl: school.logoUrl,
         contactEmail: school.contactEmail,
         contactPhone: school.contactPhone,
       } : null,
       student: {
         studentId: student.studentId,
         firstName: student.firstName,
         lastName: student.lastName,
         className: student.class?.name || null,
       },
       term,
       subjects,
       totalScore: publication.totalScore,
       average: publication.average,
       position: publication.position,
       subjectsExpected: publication.subjectsExpected,
       subjectsSubmitted: publication.subjectsSubmitted,
       overallGrade,
       overallRemark,
       publishedAt: publication.publishedAt,
     });
   });
module.exports = router;
