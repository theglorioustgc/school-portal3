// server.js
//
// This is the single entry point. Every future module (timetable.js,
// attendance.js, gradebook.js, fees.js...) gets mounted here the same
// way authRoutes is mounted below.

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');

const app = express();

app.use(cors());
app.use(express.json());

// Health check — useful once this is deployed, to confirm the backend is alive
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// --- Mount modules here as they're built ---
app.use('/auth', authRoutes);
// app.use('/timetable', timetableRoutes);   <- next module
// app.use('/attendance', attendanceRoutes);
// app.use('/gradebook', gradebookRoutes);
// app.use('/fees', feesRoutes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
