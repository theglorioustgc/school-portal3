// idGenerator.js
//
// Generates student and teacher IDs in the agreed formats:
//   Student: {SchoolCode}-{AdmissionYear}-{SequentialNumber}   e.g. GHS-2024-0089
//   Teacher: {SchoolCode}-STF-{JoinYear}-{SequentialNumber}    e.g. GHS-STF-2024-0012
//
// Uses a database transaction to increment a shared counter row,
// so two registrations happening at the same instant can never
// collide on the same number (race-condition safe).

const prisma = require('../db');

/**
 * @param {"STUDENT"|"STAFF"} idType
 * @param {number} year - admission year (student) or join year (teacher)
 * @param {string} schoolCode - e.g. "GHS"
 * @returns {Promise<string>} the generated ID
 */
async function generateId(idType, year, schoolCode) {
  const nextNumber = await prisma.$transaction(async (tx) => {
    const counter = await tx.idCounter.upsert({
      where: { idType_year: { idType, year } },
      update: { lastNumber: { increment: 1 } },
      create: { idType, year, lastNumber: 1 },
    });
    return counter.lastNumber;
  });

  const padded = String(nextNumber).padStart(4, '0');

  if (idType === 'STUDENT') {
    return `${schoolCode}-${year}-${padded}`;
  }
  if (idType === 'STAFF') {
    return `${schoolCode}-STF-${year}-${padded}`;
  }
  throw new Error(`Unknown idType: ${idType}`);
}

module.exports = { generateId };
