# TeamForge — Multi-User Project Management SaaS

TeamForge is the Week 04 Final Capstone for the Stack & Scale Remote Full-Stack Internship. It is a multi-tenant workspace and project management SaaS with authentication, RBAC (`owner`/`member`), strict server-side tenant isolation, task workflows, and SQLite analytics.

## Tech Stack
- Node.js, Express.js, SQLite (`node:sqlite`), `bcryptjs`, Vanilla JS, HTML5, Dark-Mode CSS

## Features
- Secure login with `bcryptjs` password hashing & SQLite session tokens
- Create workspaces (`owner`) or join via invite codes (`member`)
- Server-side tenant isolation blocking cross-workspace access (`403 Forbidden`)
- Full Project & Task CRUD with assignment checks, priorities, due dates, filters, and pagination
- Database-derived dashboard metrics (`Completion Rate %`) and member workload

## Setup & Run Locally
1. `git clone https://github.com/zikriya141-cpu/teamforge.git`
2. `cd teamforge`
3. `npm install`
4. `node server.js`
5. Open `http://localhost:3000` (Demo accounts: `ali@alpha.io`, `sara@alpha.io`, `usman@beta.io` | Password: `Password123!`)

## Automated Tests
Run `node api-test.js` while the server is running to verify all 5 security and lifecycle tests.

## Limitations
- Local SQLite setup (no payment/billing integrations per project scope).
- Non-expiring invite codes and manual refresh after updates.
