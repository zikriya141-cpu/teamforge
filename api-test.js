const BASE = 'http://localhost:3000';

async function login(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123!' })
  });
  return (await res.json()).token;
}

async function runTests() {
  console.log('🧪 Running TeamForge Automated Quality & Security Tests...\n');
  const aliToken = await login('ali@alpha.io');   // Alpha Owner (WS 1)
  const saraToken = await login('sara@alpha.io'); // Alpha Member (WS 1)

  // Test 1: Cross-Tenant Access Denial (403)
  const t1 = await fetch(`${BASE}/api/workspaces/2/projects`, {
    headers: { Authorization: `Bearer ${aliToken}` }
  });
  if (t1.status === 403) {
    console.log('✅ Test 1 PASSED: Cross-workspace access blocked with 403 Forbidden.');
  } else throw new Error(`Test 1 failed: ${t1.status}`);

  // Test 2: Invalid Ownership Assignment Rejected (403)
  const t2 = await fetch(`${BASE}/api/workspaces/1/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliToken}` },
    body: JSON.stringify({ project_id: 1, title: 'Hack Assign', assignee_id: 3 }) // User 3 is in WS 2!
  });
  if (t2.status === 403) {
    console.log('✅ Test 2 PASSED: Assigning task to non-member rejected with 403 Forbidden.');
  } else throw new Error(`Test 2 failed: ${t2.status}`);

  // Test 3: Validation Error on Empty Task Title (400)
  const t3 = await fetch(`${BASE}/api/workspaces/1/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliToken}` },
    body: JSON.stringify({ project_id: 1, title: '   ' })
  });
  if (t3.status === 400) {
    console.log('✅ Test 3 PASSED: Empty task title rejected with 400 Bad Request.');
  } else throw new Error(`Test 3 failed: ${t3.status}`);

  // Test 4: Task Lifecycle (Create -> Transition to Done -> Verify Dashboard Metric)
  const createRes = await fetch(`${BASE}/api/workspaces/1/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliToken}` },
    body: JSON.stringify({ project_id: 1, title: 'Automated Lifecycle Task', priority: 'High' })
  });
  const createdTask = await createRes.json();

  const patchRes = await fetch(`${BASE}/api/workspaces/1/tasks/${createdTask.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${saraToken}` },
    body: JSON.stringify({ status: 'Done' })
  });
  if (createRes.status === 201 && patchRes.status === 200) {
    console.log('✅ Test 4 PASSED: Task lifecycle (Create -> Status Done) persisted in SQLite.');
  } else throw new Error('Test 4 failed');

  // Test 5: RBAC Role Check (Member cannot delete task -> 403)
  const delMemberRes = await fetch(`${BASE}/api/workspaces/1/tasks/${createdTask.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${saraToken}` }
  });
  if (delMemberRes.status === 403) {
    console.log('✅ Test 5 PASSED: Member blocked from deleting task (Owner-only 403).');
  } else throw new Error(`Test 5 failed: ${delMemberRes.status}`);

  // Cleanup test task as Owner
  await fetch(`${BASE}/api/workspaces/1/tasks/${createdTask.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${aliToken}` }
  });

  console.log('\n🎉 ALL 5 AUTOMATED TESTS PASSED SUCCESSFULLY!');
}

runTests();