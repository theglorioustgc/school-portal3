// middleware/auth.js
//
// Every protected route in every future module (timetable, gradebook,
// fees, documents...) uses these two functions:
//   requireAuth        -> confirms the JWT is valid, attaches req.user
//   requireRole('x')    -> confirms req.user.role matches one of the allowed roles
//
// This is what enforces "a teacher can't hit an admin-only endpoint"
// at the API layer -- not just hidden in the frontend UI.

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { id, role }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

/** Usage: requireRole('admin') or requireRole('admin', 'bursar') for multiple allowed roles */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do this' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
