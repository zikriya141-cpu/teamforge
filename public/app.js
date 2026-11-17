let authToken = localStorage.getItem('tf_token') || '';
let currentUser = null;
let workspaces = [];
let activeWorkspace = null;

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
    const data = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
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
  const list = document.getElementById('workspaceList');
  list.innerHTML = workspaces.map(ws => `
    <div class="ws-item ${activeWorkspace && activeWorkspace.id === ws.id ? 'active' : ''}" onclick="selectWorkspace(${ws.id})">
      <span>${ws.name}</span>
      <span class="role-badge">${ws.role}</span>
    </div>
  `).join('');
}

window.selectWorkspace = async function(wsId) {
  activeWorkspace = workspaces.find(w => w.id === wsId);
  if (!activeWorkspace) return;

  document.getElementById('wsTitle').innerText = activeWorkspace.name;
  document.getElementById('wsDesc').innerText = activeWorkspace.description || 'Isolated team workspace';
  document.getElementById('wsInviteCode').innerText = activeWorkspace.invite_code;
  document.getElementById('wsMembersCount').innerText = activeWorkspace.member_count || 1;
  document.getElementById('activeRoleBadge').innerText = activeWorkspace.role.toUpperCase();
  document.getElementById('isolationOutput').classList.add('hidden');

  renderWorkspaceList();
  await loadWorkspaceData();
};

async function loadWorkspaceData() {
  const projects = await apiFetch(`/api/workspaces/${activeWorkspace.id}/projects`);
  const tasks = await apiFetch(`/api/workspaces/${activeWorkspace.id}/tasks`);

  document.getElementById('projectsCount').innerText = projects.length;
  document.getElementById('tasksCount').innerText = tasks.length;

  document.getElementById('projectsList').innerHTML = projects.length
    ? projects.map(p => `
      <div class="item-card">
        <div class="item-card-top">
          <strong>${p.name}</strong>
          <span class="tag-pill tag-active">${p.status}</span>
        </div>
        <small>${p.description || 'Active workspace project'}</small>
      </div>
    `).join('')
    : '<p style="color:var(--muted); font-size:0.88rem;">No projects in this workspace yet.</p>';

  document.getElementById('tasksList').innerHTML = tasks.length
    ? tasks.map(t => {
        const prioClass = t.priority === 'High' ? 'tag-high' : t.priority === 'Medium' ? 'tag-medium' : 'tag-low';
        return `
          <div class="item-card">
            <div class="item-card-top">
              <strong>${t.title}</strong>
              <span class="tag-pill ${prioClass}">${t.priority}</span>
            </div>
            <small>${t.project_name} • ${t.status} • Assignee: ${t.assignee_name || 'Unassigned'}</small>
          </div>
        `;
      }).join('')
    : '<p style="color:var(--muted); font-size:0.88rem;">No tasks in this workspace yet.</p>';
}

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
    showToast(`Joined "${joined.name}" as member!`);
    await loadWorkspaces();
  } catch (err) {
    showToast(err.message);
  }
};

document.getElementById('createProjectForm').onsubmit = async (e) => {
  e.preventDefault();
  if (!activeWorkspace) return;
  const name = document.getElementById('newProjName').value.trim();
  await apiFetch(`/api/workspaces/${activeWorkspace.id}/projects`, { method: 'POST', body: JSON.stringify({ name }) });
  document.getElementById('newProjName').value = '';
  showToast(`Project "${name}" added!`);
  await loadWorkspaceData();
};

document.getElementById('testIsolationBtn').onclick = async () => {
  const out = document.getElementById('isolationOutput');
  out.classList.remove('hidden');
  const targetId = activeWorkspace.id === 1 ? 2 : 1;
  out.innerText = `Testing GET /api/workspaces/${targetId}/projects as ${currentUser.email}...`;

  try {
    await apiFetch(`/api/workspaces/${targetId}/projects`);
    out.innerText += `\n❌ UNEXPECTED: Access was allowed!`;
  } catch (err) {
    out.innerText += `\n✅ PASSED (Blocked by Server):\n${err.message}`;
  }
};

initApp();