const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new DatabaseSync(path.join(__dirname, 'teamforge.db'));
console.log('Connected to SQLite database (teamforge.db).');

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
  const p1 = Number(insertProj.run(alphaWsId, 'API Gateway Migration', 'Migrate legacy endpoints to REST v2', 'Active').lastInsertRowid);
  const p2 = Number(insertProj.run(alphaWsId, 'Auth & RBAC Hardening', 'Enforce session tokens and tenant isolation', 'Active').lastInsertRowid);
  const p3 = Number(insertProj.run(betaWsId, 'Mobile App Redesign', 'New Figma design system and prototypes', 'Active').lastInsertRowid);

  const insertTask = db.prepare('INSERT INTO tasks (workspace_id, project_id, title, status, priority, assignee_id, due_date) VALUES (?, ?, ?, ?, ?, ?, ?)');
  insertTask.run(alphaWsId, p1, 'Configure rate limiting middleware', 'In Progress', 'High', aliId, '2026-11-20');
  insertTask.run(alphaWsId, p1, 'Write SQLite migration scripts', 'Done', 'Medium', saraId, '2026-11-18');
  insertTask.run(alphaWsId, p2, 'Verify 403 cross-tenant access denial', 'Todo', 'High', aliId, '2026-11-21');
  insertTask.run(alphaWsId, p2, 'Add automated regression tests', 'Todo', 'Medium', saraId, '2026-11-23');
  insertTask.run(betaWsId, p3, 'Finalize dark-mode color tokens', 'Todo', 'High', usmanId, '2026-11-22');
  insertTask.run(betaWsId, p3, 'Export responsive icon kit', 'In Progress', 'Low', usmanId, '2026-11-24');
}

const VALID_STATUSES = ['Todo', 'In Progress', 'Done'];
const VALID_PRIORITIES = ['Low', 'Medium', 'High'];
const VALID_PROJ_STATUSES = ['Active', 'Completed', 'Archived'];

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: '401 Unauthorized: Please sign in first.' });

  const session = db.prepare(`
    SELECT s.token, u.id, u.name, u.email
    FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ?
  `).get(token);
  if (!session) return res.status(401).json({ error: '401 Unauthorized: Invalid or expired session.' });

  req.user = { id: session.id, name: session.name, email: session.email };
  req.token = token;
  next();
}

function requireWorkspaceMember(req, res, next) {
  const workspaceId = Number(req.params.workspaceId);
  if (!workspaceId) return res.status(400).json({ error: 'Invalid workspace ID.' });

  const workspace = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(workspaceId);
  if (!workspace) return res.status(404).json({ error: 'Workspace not found.' });

  const membership = db.prepare('SELECT * FROM memberships WHERE user_id = ? AND workspace_id = ?')
    .get(req.user.id, workspaceId);
  if (!membership) {
    return res.status(403).json({
      error: `403 Forbidden: Tenant isolation enforced. "${req.user.email}" is not a member of "${workspace.name}".`
    });
  }
  req.workspace = workspace;
  req.membership = membership;
  next();
}

function requireWorkspaceOwner(req, res, next) {
  if (req.membership.role !== 'owner') {
    return res.status(403).json({ error: '403 Forbidden: Only workspace owners can delete resources.' });
  }
  next();
}

// Auth Routes
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, user.id);
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
  res.json({ message: 'Signed out successfully.' });
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));

// Workspaces & Members
app.get('/api/workspaces', requireAuth, (req, res) => {
  const workspaces = db.prepare(`
    SELECT w.*, m.role, (SELECT COUNT(*) FROM memberships m2 WHERE m2.workspace_id = w.id) AS member_count
    FROM workspaces w JOIN memberships m ON w.id = m.workspace_id
    WHERE m.user_id = ? ORDER BY w.id ASC
  `).all(req.user.id);
  res.json(workspaces);
});

app.post('/api/workspaces', requireAuth, (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Workspace name is required.' });
  const inviteCode = 'TF-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const wsRes = db.prepare('INSERT INTO workspaces (name, description, invite_code) VALUES (?, ?, ?)')
    .run(name.trim(), (description || 'Isolated team workspace').trim(), inviteCode);
  const workspaceId = Number(wsRes.lastInsertRowid);
  db.prepare('INSERT INTO memberships (user_id, workspace_id, role) VALUES (?, ?, ?)').run(req.user.id, workspaceId, 'owner');
  const created = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(workspaceId);
  res.status(201).json({ ...created, role: 'owner', member_count: 1 });
});

app.post('/api/workspaces/join', requireAuth, (req, res) => {
  const { invite_code } = req.body;
  if (!invite_code || !invite_code.trim()) return res.status(400).json({ error: 'Invite code is required.' });
  const workspace = db.prepare('SELECT * FROM workspaces WHERE invite_code = ?').get(invite_code.trim().toUpperCase());
  if (!workspace) return res.status(404).json({ error: 'Invalid invite code.' });
  const existing = db.prepare('SELECT * FROM memberships WHERE user_id = ? AND workspace_id = ?').get(req.user.id, workspace.id);
  if (existing) return res.status(400).json({ error: 'Already a member of this workspace.' });
  db.prepare('INSERT INTO memberships (user_id, workspace_id, role) VALUES (?, ?, ?)').run(req.user.id, workspace.id, 'member');
  res.json({ ...workspace, role: 'member' });
});

app.get('/api/workspaces/:workspaceId/members', requireAuth, requireWorkspaceMember, (req, res) => {
  const members = db.prepare(`
    SELECT u.id, u.name, u.email, m.role
    FROM memberships m JOIN users u ON m.user_id = u.id
    WHERE m.workspace_id = ? ORDER BY m.role DESC, u.name ASC
  `).all(req.workspace.id);
  res.json(members);
});

// Day 4: DB-Derived Dashboard Metrics & Workload
app.get('/api/workspaces/:workspaceId/dashboard', requireAuth, requireWorkspaceMember, (req, res) => {
  const wsId = req.workspace.id;
  const projectCount = db.prepare('SELECT COUNT(*) AS count FROM projects WHERE workspace_id = ?').get(wsId).count;
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total_tasks,
      COALESCE(SUM(CASE WHEN status = 'Todo' THEN 1 ELSE 0 END), 0) AS todo_count,
      COALESCE(SUM(CASE WHEN status = 'In Progress' THEN 1 ELSE 0 END), 0) AS in_progress_count,
      COALESCE(SUM(CASE WHEN status = 'Done' THEN 1 ELSE 0 END), 0) AS done_count,
      COALESCE(SUM(CASE WHEN priority = 'High' AND status != 'Done' THEN 1 ELSE 0 END), 0) AS high_priority_open
    FROM tasks WHERE workspace_id = ?
  `).get(wsId);

  const completionRate = stats.total_tasks > 0 ? Math.round((stats.done_count / stats.total_tasks) * 100) : 0;

  const workload = db.prepare(`
    SELECT u.id, u.name, m.role,
      COUNT(t.id) AS assigned_total,
      COALESCE(SUM(CASE WHEN t.status = 'Done' THEN 1 ELSE 0 END), 0) AS assigned_done
    FROM memberships m
    JOIN users u ON m.user_id = u.id
    LEFT JOIN tasks t ON t.assignee_id = u.id AND t.workspace_id = m.workspace_id
    WHERE m.workspace_id = ?
    GROUP BY u.id, u.name, m.role
    ORDER BY assigned_total DESC
  `).all(wsId);

  res.json({
    project_count: projectCount,
    ...stats,
    completion_rate: completionRate,
    workload
  });
});

// Day 3: Projects CRUD
app.get('/api/workspaces/:workspaceId/projects', requireAuth, requireWorkspaceMember, (req, res) => {
  const projects = db.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count
    FROM projects p WHERE p.workspace_id = ? ORDER BY p.id DESC
  `).all(req.workspace.id);
  res.json(projects);
});

app.post('/api/workspaces/:workspaceId/projects', requireAuth, requireWorkspaceMember, (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Project name is required.' });
  const result = db.prepare('INSERT INTO projects (workspace_id, name, description) VALUES (?, ?, ?)')
    .run(req.workspace.id, name.trim(), (description || 'Workspace project').trim());
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(result.lastInsertRowid));
  res.status(201).json(project);
});

app.patch('/api/workspaces/:workspaceId/projects/:projectId', requireAuth, requireWorkspaceMember, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND workspace_id = ?')
    .get(Number(req.params.projectId), req.workspace.id);
  if (!project) return res.status(404).json({ error: 'Project not found in this workspace.' });

  const nextStatus = req.body.status || project.status;
  if (!VALID_PROJ_STATUSES.includes(nextStatus)) {
    return res.status(400).json({ error: 'Invalid project status.' });
  }
  const nextName = req.body.name ? req.body.name.trim() : project.name;
  db.prepare('UPDATE projects SET name = ?, status = ? WHERE id = ?').run(nextName, nextStatus, project.id);
  res.json(db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id));
});

app.delete('/api/workspaces/:workspaceId/projects/:projectId', requireAuth, requireWorkspaceMember, requireWorkspaceOwner, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND workspace_id = ?')
    .get(Number(req.params.projectId), req.workspace.id);
  if (!project) return res.status(404).json({ error: 'Project not found in this workspace.' });
  db.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
  res.json({ message: 'Project deleted.' });
});

// Day 3: Tasks CRUD + Filtering + Pagination + Ownership Validation
app.get('/api/workspaces/:workspaceId/tasks', requireAuth, requireWorkspaceMember, (req, res) => {
  const { status, priority, project_id, search, page = 1, limit = 5 } = req.query;
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(20, Math.max(1, Number(limit) || 5));
  const offset = (pageNum - 1) * limitNum;

  let where = 'WHERE t.workspace_id = ?';
  const params = [req.workspace.id];

  if (status && VALID_STATUSES.includes(status)) {
    where += ' AND t.status = ?';
    params.push(status);
  }
  if (priority && VALID_PRIORITIES.includes(priority)) {
    where += ' AND t.priority = ?';
    params.push(priority);
  }
  if (project_id && Number(project_id)) {
    where += ' AND t.project_id = ?';
    params.push(Number(project_id));
  }
  if (search && search.trim()) {
    where += ' AND t.title LIKE ?';
    params.push(`%${search.trim()}%`);
  }

  const totalRow = db.prepare(`SELECT COUNT(*) AS count FROM tasks t ${where}`).get(...params);
  const tasks = db.prepare(`
    SELECT t.*, p.name AS project_name, u.name AS assignee_name
    FROM tasks t
    JOIN projects p ON t.project_id = p.id
    LEFT JOIN users u ON t.assignee_id = u.id
    ${where}
    ORDER BY t.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limitNum, offset);

  res.json({
    tasks,
    pagination: {
      total: totalRow.count,
      page: pageNum,
      limit: limitNum,
      total_pages: Math.max(1, Math.ceil(totalRow.count / limitNum))
    }
  });
});

app.post('/api/workspaces/:workspaceId/tasks', requireAuth, requireWorkspaceMember, (req, res) => {
  const { project_id, title, priority = 'Medium', assignee_id, due_date = '' } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Task title is required.' });
  if (!VALID_PRIORITIES.includes(priority)) return res.status(400).json({ error: 'Invalid priority value.' });

  // Ownership check: Project must belong to this workspace
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND workspace_id = ?')
    .get(Number(project_id), req.workspace.id);
  if (!project) {
    return res.status(400).json({ error: 'Invalid project: Project does not belong to this workspace.' });
  }

  // Ownership check: Assignee must be a member of this workspace
  let validAssigneeId = null;
  if (assignee_id) {
    const memberCheck = db.prepare('SELECT * FROM memberships WHERE user_id = ? AND workspace_id = ?')
      .get(Number(assignee_id), req.workspace.id);
    if (!memberCheck) {
      return res.status(403).json({ error: '403 Forbidden: Cannot assign task to a user outside this workspace.' });
    }
    validAssigneeId = Number(assignee_id);
  }

  const resInsert = db.prepare(`
    INSERT INTO tasks (workspace_id, project_id, title, status, priority, assignee_id, due_date)
    VALUES (?, ?, ?, 'Todo', ?, ?, ?)
  `).run(req.workspace.id, project.id, title.trim(), priority, validAssigneeId, due_date.trim());

  const created = db.prepare(`
    SELECT t.*, p.name AS project_name, u.name AS assignee_name
    FROM tasks t JOIN projects p ON t.project_id = p.id LEFT JOIN users u ON t.assignee_id = u.id
    WHERE t.id = ?
  `).get(Number(resInsert.lastInsertRowid));
  res.status(201).json(created);
});

app.patch('/api/workspaces/:workspaceId/tasks/:taskId', requireAuth, requireWorkspaceMember, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?')
    .get(Number(req.params.taskId), req.workspace.id);
  if (!task) return res.status(404).json({ error: 'Task not found in this workspace.' });

  const nextStatus = req.body.status ?? task.status;
  const nextPriority = req.body.priority ?? task.priority;
  const nextTitle = req.body.title !== undefined ? req.body.title.trim() : task.title;
  const nextDue = req.body.due_date !== undefined ? req.body.due_date.trim() : task.due_date;

  if (!nextTitle) return res.status(400).json({ error: 'Task title cannot be empty.' });
  if (!VALID_STATUSES.includes(nextStatus)) return res.status(400).json({ error: 'Invalid task status.' });
  if (!VALID_PRIORITIES.includes(nextPriority)) return res.status(400).json({ error: 'Invalid task priority.' });

  let nextAssignee = task.assignee_id;
  if (req.body.assignee_id !== undefined) {
    if (req.body.assignee_id === null || req.body.assignee_id === '') {
      nextAssignee = null;
    } else {
      const mem = db.prepare('SELECT * FROM memberships WHERE user_id = ? AND workspace_id = ?')
        .get(Number(req.body.assignee_id), req.workspace.id);
      if (!mem) return res.status(403).json({ error: '403 Forbidden: Cannot assign task to a non-member.' });
      nextAssignee = Number(req.body.assignee_id);
    }
  }

  db.prepare(`
    UPDATE tasks SET title = ?, status = ?, priority = ?, assignee_id = ?, due_date = ? WHERE id = ?
  `).run(nextTitle, nextStatus, nextPriority, nextAssignee, nextDue, task.id);

  const updated = db.prepare(`
    SELECT t.*, p.name AS project_name, u.name AS assignee_name
    FROM tasks t JOIN projects p ON t.project_id = p.id LEFT JOIN users u ON t.assignee_id = u.id
    WHERE t.id = ?
  `).get(task.id);
  res.json(updated);
});

app.delete('/api/workspaces/:workspaceId/tasks/:taskId', requireAuth, requireWorkspaceMember, requireWorkspaceOwner, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?')
    .get(Number(req.params.taskId), req.workspace.id);
  if (!task) return res.status(404).json({ error: 'Task not found in this workspace.' });
  db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  res.json({ message: 'Task deleted.' });
});

app.listen(PORT, () => {
  console.log(`TeamForge SaaS running at http://localhost:${PORT}`);
});