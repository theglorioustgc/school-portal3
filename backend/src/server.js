// server.js
//
// This is the single entry point. Every future module (documents.js,
// alumni.js, cms.js...) gets mounted here the same way the routes
// below are mounted.

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

const app = express();

app.use(cors());
app.use(express.json());

// Health check — useful once this is deployed, to confirm the backend is alive
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// --- Mount modules here as they're built ---
app.use('/auth', authRoutes);
app.use('/', classesRoutes);
app.use('/', timetableRoutes);
app.use('/', attendanceRoutes);
app.use('/', gradebookRoutes);
app.use('/', announcementsRoutes);
app.use('/', assignmentsRoutes);
app.use('/', eventsRoutes);
app.use('/', feesRoutes);
// app.use('/documents', documentsRoutes);   <- next module

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
