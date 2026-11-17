# TeamForge — System Architecture & Data Model (Day 1)

## 1. Roles & Permissions (RBAC)
- **Owner:** Creates or owns a workspace, manages projects/tasks, and shares workspace invite codes.
- **Member:** Joins a workspace via invite code, views workspace projects/tasks, and updates assigned work.
- **Tenant Isolation Rule:** Users can ONLY read or write data inside workspaces where they hold an active record in `memberships`. Cross-workspace access is strictly blocked with `403 Forbidden`.

## 2. Core User Stories
1. As a user, I can log in securely with my email and password to receive an authenticated session.
2. As a user, I can create a new workspace (becoming its `owner`) or join an existing workspace using an invite code (becoming a `member`).
3. As a workspace member, I can view projects and tasks belonging strictly to my workspace.
4. As a system, I enforce server-side tenant isolation so Workspace A users cannot access Workspace B's data.

## 3. Relational Database Schema
```text
+---------------+       +-------------------+       +-------------------+
|     users     |       |    memberships    |       |    workspaces     |
+---------------+       +-------------------+       +-------------------+
| id (PK)       |<------| user_id (FK)      |       | id (PK)           |
| name          |       | workspace_id (FK) |------>| name              |
| email (UQ)    |       | role (owner/mbr)  |       | invite_code (UQ)  |
| password_hash |       | joined_at         |       | created_at        |
+---------------+       +-------------------+       +-------------------+
                                                              |
                                                              v
+-------------------+       +-------------------+   +-------------------+
|     sessions      |       |       tasks       |   |     projects      |
+-------------------+       +-------------------+   +-------------------+
| token (PK)        |       | id (PK)           |   | id (PK)           |
| user_id (FK)      |       | project_id (FK)   |<--| workspace_id (FK) |
| created_at        |       | workspace_id (FK) |   | name              |
+-------------------+       | title             |   | description       |
                            | status            |   | status            |
                            | priority          |   | created_at        |
                            | assignee_id (FK)  |   +-------------------+
                            +-------------------+