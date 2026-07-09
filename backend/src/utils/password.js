// password.js
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const SALT_ROUNDS = 12;

/** Generates a random 8-character temp password (letters + numbers, no ambiguous chars) */
function generateTempPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no O/0, I/1 confusion
  let pass = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    pass += chars[bytes[i] % chars.length];
  }
  return pass;
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

module.exports = { generateTempPassword, hashPassword, verifyPassword };
