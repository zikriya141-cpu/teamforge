# TeamForge

### Multi-user project management SaaS with server-side tenant isolation

TeamForge is the Week 04 Final Capstone for the Stack & Scale Remote Full-Stack
Internship. It is a multi-tenant workspace and project management app: people
sign in, create a workspace (or join one with an invite code), and keep their
projects and tasks inside it. Every request is checked against the membership
table on the server before it touches data, so a user who reaches for another
team's workspace gets a `403` instead of a filtered list.

---

## 1. Roles & permissions

| Role | What they can do |
| :--- | :--- |
| `owner` | Created the workspace. Manages projects and tasks, shares the invite code, and is the only role allowed to delete projects or tasks. |
| `member` | Joined with an invite code. Reads workspace projects and tasks, creates projects and tasks, and updates assigned work. Cannot delete. |

Tenant isolation is enforced in `requireWorkspaceMember` in `server.js`: the
request's user id must have an active row in `memberships` for the workspace id
in the URL. There is no client-side filter to bypass — the check runs before
any query and answers `403 Forbidden` with a message naming the workspace.

---

## 2. Tech stack

- **Backend:** Node.js, Express 5
- **Database:** SQLite through the built-in `node:sqlite` driver (`DatabaseSync`)
- **Auth:** `bcryptjs` password hashing, random session tokens stored in SQLite
- **Frontend:** Vanilla JavaScript, HTML5, hand-written CSS with a dark theme
- **Tests:** `api-test.js`, plain `fetch` against a running server

---

## 3. Setup & run locally

1. `git clone https://github.com/zikriya141-cpu/teamforge.git`
2. `cd teamforge`
3. `npm install`
4. `node server.js`
5. Open <http://localhost:3000>

The server creates `teamforge.db` on first start and seeds it with two
workspaces, three users, three projects and six tasks.

### Demo accounts

All seeded accounts use the password `Password123!`.

| Email | Workspace | Role |
| :--- | :--- | :--- |
| `ali@alpha.io` | Alpha Engineering | owner |
| `sara@alpha.io` | Alpha Engineering | member |
| `usman@beta.io` | Beta Design Studio | owner |

The sign-in screen has quick-fill buttons for all three. `ALPHA-2026` and
`BETA-2026` are the seeded invite codes.

---

## 4. Features

- Login with hashed passwords, opaque session tokens and `POST /api/auth/logout`
  invalidating the token.
- Create a workspace (you become `owner`) or join one with an invite code
  (you become `member`, duplicate joins rejected).
- Project CRUD: create, rename, move between `Active` / `Completed` /
  `Archived`, delete (owners only).
- Task CRUD with priority (`Low`, `Medium`, `High`), status (`Todo`,
  `In Progress`, `Done`), due date and assignee.
- Assignment is validated server-side: the assignee must be a member of the
  same workspace, otherwise `403`.
- Task list filtering by status, priority, project and title search, with
  pagination (`page`, `limit`, capped at 20 per page).
- Dashboard figures are derived from the database, not the browser: project
  count, task totals per status, completion rate and per-member workload.
- An in-app "Test 403 Access" button that calls another workspace and shows the
  server's refusal.

---

## 5. REST API

All routes except login require `Authorization: Bearer <token>`.

| Method | Endpoint | Notes |
| :--- | :--- | :--- |
| `POST` | `/api/auth/login` | Returns the session token and user |
| `POST` | `/api/auth/logout` | Deletes the session row |
| `GET` | `/api/auth/me` | Current user |
| `GET` | `/api/workspaces` | Workspaces you belong to, with your role and member count |
| `POST` | `/api/workspaces` | Create a workspace, invite code generated |
| `POST` | `/api/workspaces/join` | Join by invite code |
| `GET` | `/api/workspaces/:id/members` | Members and roles |
| `GET` | `/api/workspaces/:id/dashboard` | Totals, completion rate, workload |
| `GET` | `/api/workspaces/:id/projects` | Projects with task counts |
| `POST` | `/api/workspaces/:id/projects` | Create a project |
| `PATCH` | `/api/workspaces/:id/projects/:projectId` | Rename or change status |
| `DELETE` | `/api/workspaces/:id/projects/:projectId` | Owner only |
| `GET` | `/api/workspaces/:id/tasks` | Filter, search, paginate |
| `POST` | `/api/workspaces/:id/tasks` | Create and assign a task |
| `PATCH` | `/api/workspaces/:id/tasks/:taskId` | Update status, priority, title, due date, assignee |
| `DELETE` | `/api/workspaces/:id/tasks/:taskId` | Owner only |

Errors use one shape: `{ "error": "403 Forbidden: ..." }`.

---

## 6. Data model

Six tables, foreign keys on, `ON DELETE CASCADE` from workspace down.

```text
users ──< memberships >── workspaces ──< projects ──< tasks
  │                           │                          │
  └──────< sessions           └── invite_code (UNIQUE)    └── assignee_id ──> users
```

| Table | Purpose |
| :--- | :--- |
| `users` | Name, unique email, bcrypt password hash |
| `workspaces` | Team name, description, unique invite code |
| `memberships` | `(user_id, workspace_id)` unique, role `owner` or `member` |
| `sessions` | Opaque token as primary key, tied to a user |
| `projects` | Belongs to a workspace, status `Active` / `Completed` / `Archived` |
| `tasks` | Belongs to a project and workspace, status, priority, assignee, due date |

`docs/architecture.md` has the full schema and the original user stories.

---

## 7. Project structure

```text
teamforge/
├── docs/
│   └── architecture.md      # RBAC rules, user stories, schema diagram
├── public/
│   ├── index.html           # login view + workspace shell
│   ├── app.js               # rendering, fetch calls, filters, pagination
│   └── style.css            # dark UI, grid layout, stat cards
├── api-test.js              # 5 automated security / lifecycle tests
├── server.js                # schema, seed data, auth, all routes
├── teamforge.db             # seeded SQLite database (created on first run)
└── package.json
```

---

## 8. Automated tests

With the server running in another terminal:

```bash
node api-test.js
```

The five checks:

1. Cross-workspace project read returns `403`.
2. Assigning a task to a user from another workspace returns `403`.
3. A blank task title returns `400`.
4. A task can be created and moved to `Done`, and the change persists.
5. A `member` cannot delete a task — owner-only `403`.

The script deletes the task it created at the end. It exits on the first
failure with the unexpected status code.

---

## 9. Known limitations

- Local SQLite only; no shared database or horizontal scaling.
- Invite codes do not expire or rotate, and there is no member removal flow.
- Only projects and tasks can be deleted by owners; there is no workspace
  deletion or transfer of ownership.
- Session tokens have no expiry — logging out deletes the row, nothing else.
- Dashboards read on demand; the page does not live-update after another
  member changes something, so a manual refresh is needed.
- No billing or subscription layer — this was out of scope for the capstone.
