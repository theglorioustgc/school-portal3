// server.js
//
// This is the single entry point. Every route module gets mounted
// here the same way. This is now the complete backend.

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const classesRoutes = require('./routes/classes');
const timetableRoutes = require('./routes/timetable');
const attendanceRoutes = require('./routes/attendance');
const gradebookRoutes = require('./routes/gradebook');
const announcementsRoutes = require('./routes/announcements');
const assignmentsRoutes = require('./routes/assignments');
const eventsRoutes = require('./routes/events');
const feesRoutes = require('./routes/fees');
const examsRoutes = require('./routes/exams');
const adminRoutes = require('./routes/admin');
  const flagsRoutes = require('./routes/flags');
  const gradingSchemeRoutes = require('./routes/gradingScheme');
  const termsRoutes = require('./routes/terms');
   const settingsRoutes = require('./routes/settings');
   const registrationRequestsRoutes = require('./routes/registrationRequests');

const app = express();

app.use(cors());
app.use(express.json());

// Health check — useful once this is deployed, to confirm the backend is alive
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// --- All modules ---
app.use('/auth', authRoutes);
app.use('/', classesRoutes);
app.use('/', timetableRoutes);
app.use('/', attendanceRoutes);
app.use('/', gradebookRoutes);
app.use('/', announcementsRoutes);
app.use('/', assignmentsRoutes);
app.use('/', eventsRoutes);
app.use('/', feesRoutes);
app.use('/', examsRoutes);
app.use('/', adminRoutes);
app.use('/', flagsRoutes);
 app.use('/', gradingSchemeRoutes);
   app.use('/', termsRoutes);
   app.use('/', settingsRoutes);
app.use('/', registrationRequestsRoutes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
