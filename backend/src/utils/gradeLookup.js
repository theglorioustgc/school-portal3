// gradeLookup.js
//
// Single function every module uses to turn a raw score into a
// letter grade + remark, based on the school's configured
// GradeBoundary rows. Falls back to null if no scheme is set up
// yet or the score doesn't fall in any configured range.

const prisma = require('../db');

async function lookupGrade(score) {
  if (score === null || score === undefined) return { grade: null, remark: null };

  const boundary = await prisma.gradeBoundary.findFirst({
    where: { minScore: { lte: score }, maxScore: { gte: score } },
  });

  if (!boundary) return { grade: null, remark: null };
  return { grade: boundary.grade, remark: boundary.remark };
}

module.exports = { lookupGrade };
