// db.js
// Every file that needs the database imports THIS file — never creates
// its own PrismaClient. One shared connection pool for the whole app.

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

module.exports = prisma;
