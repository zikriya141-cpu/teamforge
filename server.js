const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 1. SQLite Database Connection
const db = new DatabaseSync(path.join(__dirname, 'teamforge.db'));
console.log('Connected to SQLite database (teamforge.db).');

// 2. Relational Schema Initialization
db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS workspaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    invite_code TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS memberships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    role TEXT CHECK(role IN ('owner', 'member')) NOT NULL DEFAULT 'member',
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, workspace_id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT CHECK(status IN ('Active', 'Completed', 'Archived')) DEFAULT 'Active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    status TEXT CHECK(status IN ('Todo', 'In Progress', 'Done')) DEFAULT 'Todo',
    priority TEXT CHECK(priority IN ('Low', 'Medium', 'High')) DEFAULT 'Medium',
    assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    due_date TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 3. Seed Two Isolated Workspaces & Test Accounts
const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
if (userCount === 0) {
  const defaultHash = bcrypt.hashSync('Password123!', 10);

  const insertUser = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)');
  const aliId = Number(insertUser.run('Ali Khan', 'ali@alpha.io', defaultHash).lastInsertRowid);
  const saraId = Number(insertUser.run('Sara Ahmed', 'sara@alpha.io', defaultHash).lastInsertRowid);
  const usmanId = Number(insertUser.run('Usman Tariq', 'usman@beta.io', defaultHash).lastInsertRowid);

  const insertWs = db.prepare('INSERT INTO workspaces (name, description, invite_code) VALUES (?, ?, ?)');
  const alphaWsId = Number(insertWs.run('Alpha Engineering', 'Core backend, cloud infrastructure & REST API platform', 'ALPHA-2026').lastInsertRowid);
  const betaWsId = Number(insertWs.run('Beta Design Studio', 'Product UI/UX, design tokens & mobile prototypes', 'BETA-2026').lastInsertRowid);

  const insertMem = db.prepare('INSERT INTO memberships (user_id, workspace_id, role) VALUES (?, ?, ?)');
  insertMem.run(aliId, alphaWsId, 'owner');
  insertMem.run(saraId, alphaWsId, 'member');
  insertMem.run(usmanId, betaWsId, 'owner');

  const insertProj = db.prepare('INSERT INTO projects (workspace_id, name, description, status) VALUES (?, ?, ?, ?)');
  const p1 = Number(insertProj.run(alphaWsId, 'API Gateway Migration', 'Migrate legacy endpoints to REST v2 with rate limiting', 'Active').lastInsertRowid);
  const p2 = Number(insertProj.run(alphaWsId, 'Auth & RBAC Hardening', 'Enforce session tokens and tenant isolation checks', 'Active').lastInsertRowid);
  const p3 = Number(insertProj.run(betaWsId, 'Mobile App Redesign', 'New Figma design system and interactive prototypes', 'Active').lastInsertRowid);

  const insertTask = db.prepare('INSERT INTO tasks (workspace_id, project_id, title, status, priority, assignee_id, due_date) VALUES (?, ?, ?, ?, ?, ?, ?)');
  insertTask.run(alphaWsId, p1, 'Configure rate limiting middleware', 'In Progress', 'High', aliId, '2026-11-20');
  insertTask.run(alphaWsId, p1, 'Write SQLite migration scripts', 'Done', 'Medium', saraId, '2026-11-18');
  insertTask.run(alphaWsId, p2, 'Verify 403 cross-tenant access denial', 'Todo', 'High', aliId, '2026-11-21');
  insertTask.run(betaWsId, p3, 'Finalize dark-mode color tokens', 'Todo', 'High', usmanId, '2026-11-22');
  insertTask.run(betaWsId, p3, 'Export responsive icon kit', 'In Progress', 'Low', usmanId, '2026-11-24');

  console.log('Seeded 2 isolated workspaces, 3 users, 3 projects, and 5 tasks.');
}

// 4. Authentication & Tenant Isolation Middleware
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!token) {
    return res.status(401).json({ error: '401 Unauthorized: Please sign in first.' });
  }

  const session = db.prepare(`
    SELECT s.token, u.id, u.name, u.email
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ?
  `).get(token);

  if (!session) {
    return res.status(401).json({ error: '401 Unauthorized: Invalid or expired session.' });
  }

  req.user = { id: session.id, name: session.name, email: session.email };
  req.token = token;
  next();
}

function requireWorkspaceMember(req, res, next) {
  const workspaceId = Number(req.params.workspaceId);
  if (!workspaceId) {
    return res.status(400).json({ error: 'Invalid workspace ID.' });
  }

  const workspace = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(workspaceId);
  if (!workspace) {
    return res.status(404).json({ error: 'Workspace not found.' });
  }

  const membership = db.prepare(
    'SELECT * FROM memberships WHERE user_id = ? AND workspace_id = ?'
  ).get(req.user.id, workspaceId);

  if (!membership) {
    return res.status(403).json({
      error: `403 Forbidden: Tenant isolation enforced. "${req.user.email}" is not a member of "${workspace.name}".`
    });
  }

  req.workspace = workspace;
  req.membership = membership;
  next();
}

// 5. Auth Routes
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, user.id);

  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email }
  });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
  res.json({ message: 'Signed out successfully.' });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// 6. Workspace Routes (Scoped to Authenticated User)
app.get('/api/workspaces', requireAuth, (req, res) => {
  const workspaces = db.prepare(`
    SELECT w.*, m.role,
      (SELECT COUNT(*) FROM memberships m2 WHERE m2.workspace_id = w.id) AS member_count
    FROM workspaces w
    JOIN memberships m ON w.id = m.workspace_id
    WHERE m.user_id = ?
    ORDER BY w.id ASC
  `).all(req.user.id);

  res.json(workspaces);
});

app.post('/api/workspaces', requireAuth, (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Workspace name is required.' });
  }

  const inviteCode = 'TF-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const wsRes = db.prepare('INSERT INTO workspaces (name, description, invite_code) VALUES (?, ?, ?)')
    .run(name.trim(), (description || 'Isolated team workspace').trim(), inviteCode);
  const workspaceId = Number(wsRes.lastInsertRowid);

  db.prepare('INSERT INTO memberships (user_id, workspace_id, role) VALUES (?, ?, ?)')
    .run(req.user.id, workspaceId, 'owner');

  const created = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(workspaceId);
  res.status(201).json({ ...created, role: 'owner', member_count: 1 });
});

app.post('/api/workspaces/join', requireAuth, (req, res) => {
  const { invite_code } = req.body;
  if (!invite_code || !invite_code.trim()) {
    return res.status(400).json({ error: 'Invite code is required.' });
  }

  const workspace = db.prepare('SELECT * FROM workspaces WHERE invite_code = ?')
    .get(invite_code.trim().toUpperCase());
  if (!workspace) {
    return res.status(404).json({ error: 'Invalid invite code. Workspace not found.' });
  }

  const existing = db.prepare('SELECT * FROM memberships WHERE user_id = ? AND workspace_id = ?')
    .get(req.user.id, workspace.id);
  if (existing) {
    return res.status(400).json({ error: 'You are already a member of this workspace.' });
  }

  db.prepare('INSERT INTO memberships (user_id, workspace_id, role) VALUES (?, ?, ?)')
    .run(req.user.id, workspace.id, 'member');

  res.json({ ...workspace, role: 'member' });
});

// 7. Protected Workspace Data Routes (Projects & Tasks)
app.get('/api/workspaces/:workspaceId/projects', requireAuth, requireWorkspaceMember, (req, res) => {
  const projects = db.prepare('SELECT * FROM projects WHERE workspace_id = ? ORDER BY id DESC')
    .all(req.workspace.id);
  res.json(projects);
});

app.post('/api/workspaces/:workspaceId/projects', requireAuth, requireWorkspaceMember, (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Project name is required.' });
  }

  const result = db.prepare('INSERT INTO projects (workspace_id, name, description) VALUES (?, ?, ?)')
    .run(req.workspace.id, name.trim(), (description || 'Workspace project').trim());
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(result.lastInsertRowid));
  res.status(201).json(project);
});

app.get('/api/workspaces/:workspaceId/tasks', requireAuth, requireWorkspaceMember, (req, res) => {
  const tasks = db.prepare(`
    SELECT t.*, p.name AS project_name, u.name AS assignee_name
    FROM tasks t
    JOIN projects p ON t.project_id = p.id
    LEFT JOIN users u ON t.assignee_id = u.id
    WHERE t.workspace_id = ?
    ORDER BY t.id DESC
  `).all(req.workspace.id);
  res.json(tasks);
});

app.listen(PORT, () => {
  console.log(`TeamForge SaaS running at http://localhost:${PORT}`);
});