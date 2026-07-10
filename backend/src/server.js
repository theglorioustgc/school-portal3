// server.js
//
// This is the single entry point. Every future module (fees.js,
// documents.js...) gets mounted here the same way the routes
// below are mounted.

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const classesRoutes = require('./routes/classes');
const timetableRoutes = require('./routes/timetable');
const attendanceRoutes = require('./routes/attendance');
const gradebookRoutes = require('./routes/gradebook');

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
// app.use('/fees', feesRoutes);   <- next module

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
