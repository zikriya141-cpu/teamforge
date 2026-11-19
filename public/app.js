let authToken = localStorage.getItem('tf_token') || '';
let currentUser = null;
let workspaces = [];
let activeWorkspace = null;
let workspaceProjects = [];
let workspaceMembers = [];
let currentPage = 1;
let totalPages = 1;

const authView = document.getElementById('authView');
const appView = document.getElementById('appView');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const toast = document.getElementById('toast');

function showToast(msg) {
  toast.innerText = msg;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3200);
}

window.fillDemo = function(email) {
  document.getElementById('loginEmail').value = email;
  document.getElementById('loginPassword').value = 'Password123!';
};

async function apiFetch(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const res = await fetch(url, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

loginForm.onsubmit = async (e) => {
  e.preventDefault();
  loginError.classList.add('hidden');
  try {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const data = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    authToken = data.token;
    localStorage.setItem('tf_token', authToken);
    await initApp();
  } catch (err) {
    loginError.innerText = err.message;
    loginError.classList.remove('hidden');
  }
};

document.getElementById('logoutBtn').onclick = async () => {
  try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch (_) {}
  authToken = '';
  activeWorkspace = null;
  localStorage.removeItem('tf_token');
  appView.classList.add('hidden');
  authView.classList.remove('hidden');
};

async function initApp() {
  if (!authToken) return;
  try {
    const me = await apiFetch('/api/auth/me');
    currentUser = me.user;
    document.getElementById('currentUserLabel').innerText = `${currentUser.name} (${currentUser.email})`;
    authView.classList.add('hidden');
    appView.classList.remove('hidden');
    await loadWorkspaces();
  } catch (_) {
    authToken = '';
    localStorage.removeItem('tf_token');
  }
}

async function loadWorkspaces() {
  workspaces = await apiFetch('/api/workspaces');
  renderWorkspaceList();
  if (workspaces.length > 0 && (!activeWorkspace || !workspaces.some(w => w.id === activeWorkspace.id))) {
    await selectWorkspace(workspaces[0].id);
  }
}

function renderWorkspaceList() {
  document.getElementById('workspaceList').innerHTML = workspaces.map(ws => `
    <div class="ws-item ${activeWorkspace && activeWorkspace.id === ws.id ? 'active' : ''}" onclick="selectWorkspace(${ws.id})">
      <span>${ws.name}</span>
      <span class="role-badge">${ws.role}</span>
    </div>
  `).join('');
}

window.selectWorkspace = async function(wsId) {
  activeWorkspace = workspaces.find(w => w.id === wsId);
  if (!activeWorkspace) return;
  currentPage = 1;

  document.getElementById('wsTitle').innerText = activeWorkspace.name;
  document.getElementById('wsDesc').innerText = activeWorkspace.description || 'Isolated team workspace';
  document.getElementById('wsInviteCode').innerText = activeWorkspace.invite_code;
  document.getElementById('wsMembersCount').innerText = activeWorkspace.member_count || 1;
  document.getElementById('activeRoleBadge').innerText = activeWorkspace.role.toUpperCase();
  document.getElementById('isolationOutput').classList.add('hidden');

  renderWorkspaceList();
  await refreshAllWorkspaceData();
};

async function refreshAllWorkspaceData() {
  await Promise.all([loadDashboard(), loadMembers(), loadProjects()]);
  await loadTasks();
}

async function loadDashboard() {
  const dash = await apiFetch(`/api/workspaces/${activeWorkspace.id}/dashboard`);
  document.getElementById('dashProjects').innerText = dash.project_count;
  document.getElementById('dashTasks').innerText = dash.total_tasks;
  document.getElementById('dashInProgress').innerText = dash.in_progress_count;
  document.getElementById('dashCompletion').innerText = `${dash.completion_rate}%`;
  document.getElementById('dashProgressBar').style.width = `${dash.completion_rate}%`;

  document.getElementById('workloadList').innerHTML = dash.workload.map(m => `
    <div class="item-card" style="padding:0.75rem 0.9rem;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <strong>${m.name} <span class="role-badge">${m.role}</span></strong>
        <span style="font-size:0.82rem; font-family:'JetBrains Mono'; color:var(--cyan);">
          ${m.assigned_done}/${m.assigned_total} Done
        </span>
      </div>
    </div>
  `).join('');
}

async function loadMembers() {
  workspaceMembers = await apiFetch(`/api/workspaces/${activeWorkspace.id}/members`);
  const sel = document.getElementById('newTaskAssignee');
  sel.innerHTML = `<option value="">Unassigned</option>` +
    workspaceMembers.map(m => `<option value="${m.id}">${m.name} (${m.role})</option>`).join('');
}

async function loadProjects() {
  workspaceProjects = await apiFetch(`/api/workspaces/${activeWorkspace.id}/projects`);
  document.getElementById('projectsCount').innerText = workspaceProjects.length;

  const projSel = document.getElementById('newTaskProject');
  projSel.innerHTML = workspaceProjects.length
    ? workspaceProjects.map(p => `<option value="${p.id}">${p.name}</option>`).join('')
    : `<option value="">Create a project first</option>`;

  document.getElementById('projectsList').innerHTML = workspaceProjects.length
    ? workspaceProjects.map(p => `
      <div class="item-card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.35rem;">
          <strong>${p.name}</strong>
          <span class="tag-pill tag-active">${p.status}</span>
        </div>
        <small style="color:var(--muted); display:block; margin-bottom:0.5rem;">${p.description || 'Workspace project'}</small>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:0.76rem; color:var(--cyan);">${p.task_count || 0} Tasks</span>
          ${activeWorkspace.role === 'owner' ? `<button class="icon-del-btn" onclick="deleteProject(${p.id})">Delete</button>` : ''}
        </div>
      </div>
    `).join('')
    : '<p style="color:var(--muted); font-size:0.88rem;">No projects yet.</p>';
}

async function loadTasks() {
  const status = document.getElementById('filterStatus').value;
  const priority = document.getElementById('filterPriority').value;
  const search = document.getElementById('filterSearch').value.trim();

  const params = new URLSearchParams({ page: currentPage, limit: 5 });
  if (status) params.set('status', status);
  if (priority) params.set('priority', priority);
  if (search) params.set('search', search);

  const data = await apiFetch(`/api/workspaces/${activeWorkspace.id}/tasks?${params.toString()}`);
  totalPages = data.pagination.total_pages;
  document.getElementById('pageInfo').innerText = `Page ${data.pagination.page} of ${totalPages} (${data.pagination.total} tasks)`;
  document.getElementById('prevPageBtn').disabled = currentPage <= 1;
  document.getElementById('nextPageBtn').disabled = currentPage >= totalPages;

  document.getElementById('tasksList').innerHTML = data.tasks.length
    ? data.tasks.map(t => {
        const prioClass = t.priority === 'High' ? 'tag-high' : t.priority === 'Medium' ? 'tag-medium' : 'tag-low';
        return `
          <div class="item-card task-row">
            <div>
              <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.2rem;">
                <strong>${t.title}</strong>
                <span class="tag-pill ${prioClass}">${t.priority}</span>
              </div>
              <small style="color:var(--muted);">
                ${t.project_name} • Assignee: ${t.assignee_name || 'Unassigned'} ${t.due_date ? '• Due: ' + t.due_date : ''}
              </small>
            </div>
            <div class="task-controls">
              <select class="status-select" onchange="updateTaskStatus(${t.id}, this.value)">
                <option value="Todo" ${t.status === 'Todo' ? 'selected' : ''}>Todo</option>
                <option value="In Progress" ${t.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
                <option value="Done" ${t.status === 'Done' ? 'selected' : ''}>Done</option>
              </select>
              ${activeWorkspace.role === 'owner' ? `<button class="icon-del-btn" onclick="deleteTask(${t.id})">Delete</button>` : ''}
            </div>
          </div>
        `;
      }).join('')
    : '<p style="color:var(--muted); font-size:0.88rem;">No tasks match your filters.</p>';
}

window.updateTaskStatus = async function(taskId, status) {
  try {
    await apiFetch(`/api/workspaces/${activeWorkspace.id}/tasks/${taskId}`, {
      method: 'PATCH', body: JSON.stringify({ status })
    });
    showToast(`Task updated to "${status}"`);
    await refreshAllWorkspaceData();
  } catch (err) {
    showToast(err.message);
  }
};

window.deleteTask = async function(taskId) {
  try {
    await apiFetch(`/api/workspaces/${activeWorkspace.id}/tasks/${taskId}`, { method: 'DELETE' });
    showToast('Task deleted');
    await refreshAllWorkspaceData();
  } catch (err) {
    showToast(err.message);
  }
};

window.deleteProject = async function(projectId) {
  try {
    await apiFetch(`/api/workspaces/${activeWorkspace.id}/projects/${projectId}`, { method: 'DELETE' });
    showToast('Project deleted');
    await refreshAllWorkspaceData();
  } catch (err) {
    showToast(err.message);
  }
};

document.getElementById('createProjectForm').onsubmit = async (e) => {
  e.preventDefault();
  const name = document.getElementById('newProjName').value.trim();
  const description = document.getElementById('newProjDesc').value.trim();
  await apiFetch(`/api/workspaces/${activeWorkspace.id}/projects`, { method: 'POST', body: JSON.stringify({ name, description }) });
  document.getElementById('newProjName').value = '';
  document.getElementById('newProjDesc').value = '';
  showToast(`Project "${name}" created!`);
  await refreshAllWorkspaceData();
};

document.getElementById('createTaskForm').onsubmit = async (e) => {
  e.preventDefault();
  const title = document.getElementById('newTaskTitle').value.trim();
  const project_id = document.getElementById('newTaskProject').value;
  const priority = document.getElementById('newTaskPriority').value;
  const assignee_id = document.getElementById('newTaskAssignee').value;
  const due_date = document.getElementById('newTaskDue').value;

  if (!project_id) return showToast('Please create a project first.');
  try {
    await apiFetch(`/api/workspaces/${activeWorkspace.id}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ title, project_id: Number(project_id), priority, assignee_id: assignee_id ? Number(assignee_id) : null, due_date })
    });
    document.getElementById('newTaskTitle').value = '';
    showToast('Task added!');
    await refreshAllWorkspaceData();
  } catch (err) {
    showToast(err.message);
  }
};

document.getElementById('filterStatus').onchange = () => { currentPage = 1; loadTasks(); };
document.getElementById('filterPriority').onchange = () => { currentPage = 1; loadTasks(); };
document.getElementById('filterSearch').oninput = () => { currentPage = 1; loadTasks(); };
document.getElementById('prevPageBtn').onclick = () => { if (currentPage > 1) { currentPage--; loadTasks(); } };
document.getElementById('nextPageBtn').onclick = () => { if (currentPage < totalPages) { currentPage++; loadTasks(); } };

document.getElementById('createWsForm').onsubmit = async (e) => {
  e.preventDefault();
  const name = document.getElementById('newWsName').value.trim();
  const created = await apiFetch('/api/workspaces', { method: 'POST', body: JSON.stringify({ name }) });
  document.getElementById('newWsName').value = '';
  activeWorkspace = created;
  showToast(`Workspace "${created.name}" created!`);
  await loadWorkspaces();
};

document.getElementById('joinWsForm').onsubmit = async (e) => {
  e.preventDefault();
  const invite_code = document.getElementById('joinInviteCode').value.trim();
  try {
    const joined = await apiFetch('/api/workspaces/join', { method: 'POST', body: JSON.stringify({ invite_code }) });
    document.getElementById('joinInviteCode').value = '';
    activeWorkspace = joined;
    showToast(`Joined "${joined.name}"!`);
    await loadWorkspaces();
  } catch (err) {
    showToast(err.message);
  }
};

document.getElementById('testIsolationBtn').onclick = async () => {
  const out = document.getElementById('isolationOutput');
  out.classList.remove('hidden');
  const targetId = activeWorkspace.id === 1 ? 2 : 1;
  out.innerText = `Testing GET /api/workspaces/${targetId}/projects as ${currentUser.email}...`;
  try {
    await apiFetch(`/api/workspaces/${targetId}/projects`);
    out.innerText += `\n❌ UNEXPECTED: Access allowed!`;
  } catch (err) {
    out.innerText += `\n✅ PASSED (Blocked by Server):\n${err.message}`;
  }
};

initApp();