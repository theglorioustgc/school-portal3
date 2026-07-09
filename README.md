# School Portal — Foundation Build (Phase 0)

This is the **first piece** of the full build plan: the foundation layer everything else
depends on. It gives you a working database + a working login system for all four roles,
using the exact rules we agreed on.

---

## How everything links together

```
[Supabase Postgres]  <-- one database, per school instance
        ^
        |  (Prisma ORM translates JS code <-> SQL automatically)
        |
[backend/prisma/schema.prisma]   <- defines every table
        |
[backend/src/db.js]              <- the ONE shared connection every route uses
        |
[backend/src/utils/*.js]         <- reusable logic (ID generation, password hashing)
        |
[backend/src/middleware/auth.js] <- checks "is this person logged in / allowed here"
        |
[backend/src/routes/auth.js]     <- the actual API endpoints (login, register)
        |
[backend/src/server.js]          <- wires all routes together, starts the server
        |
        v
   (later) frontend (React/Next.js) calls these endpoints over HTTP,
   e.g. fetch('https://your-backend-url/auth/login', { method: 'POST', ... })
```

**The rule going forward:** every new module (timetable, attendance, gradebook, fees,
documents...) follows this exact same shape:
1. Add its tables to `schema.prisma`
2. Add a `utils/` file if it needs reusable logic
3. Add a `routes/xyz.js` file with its endpoints, protected by `requireAuth` / `requireRole`
4. Mount it in `server.js` with one line: `app.use('/xyz', xyzRoutes)`

Nothing new is invented each time — it's the same five-file pattern, over and over.

---

## What's built in this phase

- **Database schema** (`prisma/schema.prisma`): SchoolConfig, IdCounter, Student, Teacher,
  AdminUser, BursarUser, SchoolClass, Subject, TeacherAssignment
- **ID generation**: student IDs (`GHS-2024-0089`) and teacher IDs (`GHS-STF-2024-0012`),
  race-condition-safe via a database transaction
- **Login**: one field, auto-detects ID vs email, routes to the correct table, returns a
  session token (JWT) — exactly the rule we finalized
- **Password security**: bcrypt hashing (never plain text), temp password generation,
  forced change on first login
- **Role gating**: `requireAuth` + `requireRole(...)` middleware — the same two functions
  every future protected route will reuse

---

## How to actually run this

### 1. Set up Supabase (or any Postgres database)
- Create a free project at supabase.com
- Copy the connection string from Project Settings → Database

### 2. Install dependencies
```bash
cd backend
npm install
```

### 3. Configure environment
```bash
cp .env.example .env
# then edit .env and paste in your real DATABASE_URL and a random JWT_SECRET
```

### 4. Create the database tables
```bash
npm run prisma:migrate
```
This reads `schema.prisma` and creates every table in your actual database — you don't
write any SQL by hand.

### 5. Seed one school config + one admin account
You'll want a small one-time script for this (not included yet) that inserts:
- One `SchoolConfig` row (school code, name, colors)
- One `AdminUser` row (email + a hashed password) — since there's no registration
  endpoint for admin (that's a deliberate, deployed-once setup step per school, not
  something exposed over the API)

### 6. Run the server
```bash
npm run dev
```
Visit `http://localhost:4000/health` — you should see `{"status":"ok"}`.

### 7. Test the login endpoint
```bash
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier": "admin@school.com", "password": "yourpassword"}'
```

---

## What's next (in build order, per the plan)

1. **Classes & Subjects admin endpoints** — CRUD so an admin can create `SchoolClass` /
   `Subject` rows and `TeacherAssignment` links (this unlocks every dropdown everywhere else)
2. **Timetable module** — `timetable_entries` table + conflict-check logic (teacher and
   class double-booking) we agreed on
3. **Attendance module**
4. **Gradebook module** (draft → submitted, CA1–CA3 + exam, auto-compilation)
5. **Fee-confirmation portal** (separate login flow reusing this same auth system, just
   scoped to the bursar role)
6. Everything else from the build plan, in the same order

Each of these will be handed to you the same way this one was: schema additions, utility
functions, routes, and a one-line mount in `server.js` — so the project never becomes
harder to reason about as it grows, just bigger.
