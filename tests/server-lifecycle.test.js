// Production handlers + real SQLite/Git: state, index and cancellation must agree.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-server-lifecycle-'));
const project = path.join(fixture, 'project');
fs.mkdirSync(project);
function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
}
git(project, 'init', '-q', '-b', 'main');
git(project, 'config', 'user.name', 'Lifecycle tests');
git(project, 'config', 'user.email', 'lifecycle@example.invalid');
git(project, 'config', 'commit.gpgsign', 'false');
fs.writeFileSync(path.join(project, '.gitignore'), '.jira-dashboard/\n.worktrees/\n');
fs.writeFileSync(path.join(project, 'base.txt'), 'base\n');
git(project, 'add', '.');
git(project, 'commit', '-qm', 'base');
const config = {
  projectDir: project, projectName: 'lifecycle', dataDir: path.join(project, '.jira-dashboard'),
  worktreesDir: path.join(project, '.worktrees'), numWorktrees: 0, branchDefault: 'main',
  port: 0, dbBusyTimeout: 5000, mergeStrategy: 'cherry-pick',
  coder: { type: 'dummy', bin: 'unused', timeouts: { command: 10000, clarify: 5000, implement: 5000, suggest: 5000 } },
  test: { enabled: false, timeout: 5000 }, venv: { pythonpath: 'src' },
  prCheckIgnore: [], prReworkChecks: [],
  ticketContextDir(id) { return path.join(project, '.jira-dashboard', 'tickets', id); },
};
const configId = require.resolve('../config');
const coderId = require.resolve('../coder');
require.cache[configId] = { id: configId, filename: configId, loaded: true, exports: config };
let coderImpl = async () => ({ text: 'done' });
require.cache[coderId] = {
  id: coderId, filename: coderId, loaded: true,
  exports: { run: (...args) => coderImpl(...args), getLastSessionId: () => 'another-ticket-session' },
};
const db = require('../db');
const worktrees = require('../worktree-manager');
const { runTicketOperation, captureSessionId } = require('../coder-runner');
const { app, runClarify, generateSuggestions } = require('../server');
function ticket(id, fields = {}) {
  const now = new Date().toISOString();
  return db.createTicket({ id, title: id, content: 'test', stage: 'implementation', created_at: now, updated_at: now, ...fields });
}
async function call(method, route, id, body = {}) {
  const layer = app.router.stack.find(layer => layer.route?.path === route && layer.route.methods[method.toLowerCase()]);
  assert.ok(layer, `Missing handler: ${method} ${route}`);
  const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.body = data; return this; } };
  await layer.route.stack[0].handle({ params: { id }, body }, res);
  return res;
}
const turn = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate, timeout = 3000) {
  const expires = Date.now() + timeout;
  while (!predicate()) {
    assert.ok(Date.now() < expires, 'Timed out waiting for fixture');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function implemented(id, filename, contents = 'feature\n', fields = {}) {
  ticket(id, fields);
  coderImpl = async (_prompt, opts) => {
    fs.writeFileSync(path.join(opts.cwd, filename), contents);
    git(opts.cwd, 'add', '.'); git(opts.cwd, 'commit', '-qm', 'agent commit');
    return { text: 'implemented' };
  };
  const result = await call('POST', '/api/tickets/:id/implement', id);
  assert.equal(result.code, 200);
  assert.equal(db.getTicket(id).stage, 'review');
  return db.getTicket(id);
}

(async () => {
  try {
    // Ordinary agents already commit their work. Ready must accept that branch,
    // update the checked-out target's index and preserve it in the next commit.
    const normal = await implemented('normal', 'feature.txt');
    assert.ok(normal.base_sha);
    const ready = await call('POST', '/api/tickets/:id/ready', normal.id);
    assert.equal(ready.code, 200, JSON.stringify(ready.body));
    assert.equal(db.getTicket(normal.id).stage, 'done');
    assert.equal(git(project, 'status', '--porcelain'), '');
    assert.equal(fs.readFileSync(path.join(project, 'feature.txt'), 'utf8'), 'feature\n');
    fs.writeFileSync(path.join(project, 'next.txt'), 'next unrelated change\n');
    git(project, 'add', 'next.txt'); git(project, 'commit', '-qm', 'next unrelated change');
    assert.equal(git(project, 'show', 'HEAD:feature.txt'), 'feature');
    console.log('PASS: committed implementation → Ready leaves a consistent checkout and survives the next commit');

    // Independent staged and unstaged edits may be carried through a fast
    // forward, or Git may refuse. In either case preserve their exact index.
    const dirty = await implemented('dirty', 'dirty-feature.txt');
    fs.writeFileSync(path.join(project, 'next.txt'), 'staged user edit\n'); git(project, 'add', 'next.txt');
    fs.writeFileSync(path.join(project, 'base.txt'), 'unstaged user edit\n');
    const stagedBefore = git(project, 'diff', '--cached', '--binary');
    const unstagedBefore = git(project, 'diff', '--binary');
    const dirtyReady = await call('POST', '/api/tickets/:id/ready', dirty.id);
    assert.ok([200, 409].includes(dirtyReady.code), JSON.stringify(dirtyReady.body));
    assert.equal(git(project, 'diff', '--cached', '--binary'), stagedBefore);
    assert.equal(git(project, 'diff', '--binary'), unstagedBefore);
    git(project, 'restore', '--staged', 'next.txt'); git(project, 'restore', 'next.txt', 'base.txt');
    if (dirtyReady.code === 409) assert.equal((await call('POST', '/api/tickets/:id/ready', dirty.id)).code, 200);
    console.log('PASS: integration preserves independent staged and unstaged user changes');

    // A conflicting target edit must remain untouched and leave a retryable
    // review ticket. A retry also covers a previously prepared squash commit.
    const conflict = await implemented('conflict', 'base.txt', 'ticket edit\n');
    const oldMain = git(project, 'rev-parse', 'main');
    fs.writeFileSync(path.join(project, 'base.txt'), 'overlapping local edit\n');
    const blocked = await call('POST', '/api/tickets/:id/ready', conflict.id);
    assert.equal(blocked.code, 409, JSON.stringify(blocked.body));
    assert.equal(fs.readFileSync(path.join(project, 'base.txt'), 'utf8'), 'overlapping local edit\n');
    assert.equal(git(project, 'rev-parse', 'main'), oldMain);
    assert.equal(db.getTicket(conflict.id).stage, 'review');
    assert.equal(db.getTicket(conflict.id).status, 'idle');
    git(project, 'restore', 'base.txt');
    assert.equal((await call('POST', '/api/tickets/:id/ready', conflict.id)).code, 200);
    console.log('PASS: overlapping target WIP blocks integration without moving target ref and permits retry');

    // Legacy tickets without a branch-point still accept committed work in a
    // repository with no remote-tracking default branch at all.
    const legacy = await implemented('legacy-base', 'legacy.txt');
    db.updateTicket(legacy.id, { base_sha: null });
    assert.equal((await call('POST', '/api/tickets/:id/ready', legacy.id)).code, 200);
    console.log('PASS: Ready repairs legacy missing-base tickets without requiring origin/main');

    // If a coder or user changed branches inside the ticket worktree, Ready
    // must not rewrite the new branch or the saved ticket branch.
    const drift = await implemented('branch-drift', 'drift.txt');
    git(drift.worktree_path, 'checkout', '-b', 'unexpected-branch');
    const originalTicketRef = git(project, 'rev-parse', drift.branch_name);
    const originalOtherRef = git(project, 'rev-parse', 'unexpected-branch');
    const refusedDrift = await call('POST', '/api/tickets/:id/ready', drift.id);
    assert.equal(refusedDrift.code, 500);
    assert.match(refusedDrift.body.error, /not on ticket branch/);
    assert.equal(git(project, 'rev-parse', drift.branch_name), originalTicketRef);
    assert.equal(git(project, 'rev-parse', 'unexpected-branch'), originalOtherRef);
    assert.equal(db.getTicket(drift.id).status, 'idle');
    await call('POST', '/api/tickets/:id/close', drift.id);
    console.log('PASS: Ready refuses branch drift without rewriting either branch');

    // The coder has exited; the operation is still waiting for structured
    // output. Busy status and ownership must span that entire wait.
    ticket('output-wait', { stage: 'clarification' });
    coderImpl = async () => ({ text: 'waiting for file' });
    const waiting = runClarify('output-wait').catch(err => err);
    await turn();
    assert.equal(db.getTicket('output-wait').status, 'running');
    assert.equal((await call('POST', '/api/tickets/:id/clarify', 'output-wait')).code, 409);
    await call('POST', '/api/tickets/:id/close', 'output-wait');
    assert.equal((await waiting).code, 'TICKET_CANCELLED');
    fs.writeFileSync(path.join(config.ticketContextDir('output-wait'), 'clarification.json'), JSON.stringify({ ready: true, questions: [], plan: 'late plan' }));
    await turn();
    assert.equal(db.getTicket('output-wait').stage, 'done');
    assert.equal(db.getTicket('output-wait').plan, null);
    console.log('PASS: close cancels structured-output waits and defeats late completion');

    // Acquire can yield before a coder exists. Reserve ownership first and
    // make close wait for setup to settle before releasing its new worktree.
    ticket('acquire-wait');
    const gate = deferred();
    const originalAcquire = worktrees.acquire;
    let acquisitions = 0;
    worktrees.acquire = async t => { acquisitions++; await gate.promise; return originalAcquire(t); };
    const implementing = call('POST', '/api/tickets/:id/implement', 'acquire-wait');
    await turn();
    assert.equal((await call('POST', '/api/tickets/:id/implement', 'acquire-wait')).code, 409);
    let closeSettled = false;
    const closing = call('POST', '/api/tickets/:id/close', 'acquire-wait').then(r => { closeSettled = true; return r; });
    await turn(); assert.equal(closeSettled, false);
    gate.resolve();
    await Promise.all([implementing, closing]);
    worktrees.acquire = originalAcquire;
    assert.equal(acquisitions, 1);
    assert.equal(db.getTicket('acquire-wait').stage, 'done');
    assert.equal(db.getTicket('acquire-wait').worktree_path, null);
    console.log('PASS: duplicate implement is rejected during acquire, and close waits before cleanup');

    // A late result after cancellation must settle before deletion; the
    // continuation cannot insert activity/questions against the deleted row.
    ticket('delete-running', { stage: 'clarification' });
    let coderSettled = false;
    coderImpl = (_prompt, opts) => new Promise(resolve => {
      opts.signal.addEventListener('abort', () => setTimeout(() => {
        coderSettled = true;
        resolve({ text: '{"ready":true,"questions":[],"plan":"late"}' });
      }, 30), { once: true });
    });
    const deletingClarification = call('POST', '/api/tickets/:id/clarify', 'delete-running');
    await turn();
    const deleted = await call('DELETE', '/api/tickets/:id', 'delete-running');
    await deletingClarification;
    assert.equal(deleted.code, 200); assert.equal(coderSettled, true);
    assert.equal(db.getTicket('delete-running'), null);
    console.log('PASS: delete waits for cancelled execution before deleting the row');

    // Auto-create uses the same failure persistence as the explicit endpoint.
    coderImpl = async () => { throw new Error('CLI authentication failed'); };
    const created = await call('POST', '/api/tickets', null, { title: 'automatic failure' });
    await turn();
    const failed = db.getTicket(created.body.id);
    assert.equal(failed.status, 'idle');
    assert.equal(failed.activity.filter(a => a.action === 'clarify_error').length, 1);
    assert.match(failed.activity.find(a => a.action === 'clarify_error').detail, /authentication failed/);
    console.log('PASS: automatic clarification failure records an error and restores idle status');

    // Deferred same-ticket follow-ups inherit an ALS context. Once the old run
    // has settled, they must acquire a fresh owner rather than reuse stale one.
    ticket('deferred', { stage: 'clarification' });
    const followed = deferred();
    await runTicketOperation('deferred', async () => {
      setImmediate(() => runTicketOperation('deferred', async () => 'new run').then(followed.resolve, followed.resolve));
    });
    assert.equal(await followed.promise, 'new run');
    assert.equal(captureSessionId('deferred', undefined), null);
    assert.equal(db.getTicket('deferred').ocode_session, null);
    console.log('PASS: deferred follow-ups get fresh ownership and do not capture another ticket session');

    // A manually launched test owns the worktree even while ticket status is
    // idle. Close must stop it before release and prohibit writes afterwards.
    ticket('running-tests');
    const testWorktree = await worktrees.acquire(db.getTicket('running-tests'));
    const started = path.join(fixture, 'manual-test-started');
    const leakedWrite = path.join(fixture, 'manual-test-leaked');
    config.test.commandOverride = `touch '${started}'; (sleep 1; touch '${leakedWrite}') & wait`;
    const testStart = await call('POST', '/api/tickets/:id/tests/run', 'running-tests');
    await until(() => fs.existsSync(started));
    await call('POST', '/api/tickets/:id/close', 'running-tests');
    assert.equal(db.getLatestTestRun('running-tests').status, 'error');
    assert.equal(fs.existsSync(testWorktree.worktreePath), false);
    await new Promise(resolve => setTimeout(resolve, 1050));
    assert.equal(fs.existsSync(leakedWrite), false);
    assert.equal((await call('POST', '/api/tickets/:id/tests/run', 'running-tests')).code, 409);
    config.test.commandOverride = null;
    assert.ok(testStart.body.run_id);
    console.log('PASS: close settles manual test process trees before releasing worktrees');

    // The project-level runner uses the same bounded process ownership. A
    // timed-out background descendant must not survive after the API completes.
    const topLevelLeak = path.join(fixture, 'project-test-leaked');
    config.test.commandOverride = `(sleep 0.8; touch '${topLevelLeak}') & wait`;
    config.test.timeout = 100;
    const projectTest = await call('POST', '/api/test', null);
    let projectResult;
    const deadline = Date.now() + 3000;
    do {
      projectResult = await call('GET', '/api/run/:id', projectTest.body.runId);
      if (projectResult.body.status !== 'running') break;
      assert.ok(Date.now() < deadline, 'Project-level timeout did not settle');
      await new Promise(resolve => setTimeout(resolve, 20));
    } while (true);
    assert.equal(projectResult.body.status, 'fail');
    assert.match(projectResult.body.output, /Timed out/);
    await new Promise(resolve => setTimeout(resolve, 850));
    assert.equal(fs.existsSync(topLevelLeak), false);
    config.test.commandOverride = null;
    config.test.timeout = 5000;
    console.log('PASS: project test API enforces process-tree timeout and reports failure');

    // An explicit lease must reject a remote update made after our branch was
    // read. Exercise the real background push path against a local bare remote.
    const remote = path.join(fixture, 'remote.git');
    git(fixture, 'clone', '--bare', project, remote);
    git(project, 'remote', 'add', 'origin', remote);
    const lease = await implemented('pr-lease', 'lease.txt');
    const observed = git(project, 'rev-parse', 'main');
    git(remote, 'update-ref', `refs/heads/${lease.branch_name}`, observed);
    git(project, 'update-ref', `refs/remotes/origin/${lease.branch_name}`, observed);
    const other = path.join(fixture, 'other-author');
    git(fixture, 'clone', remote, other);
    git(other, 'config', 'user.name', 'Other author'); git(other, 'config', 'user.email', 'other@example.invalid');
    git(other, 'config', 'commit.gpgsign', 'false');
    git(other, 'checkout', '-b', lease.branch_name, `origin/${lease.branch_name}`);
    fs.writeFileSync(path.join(other, 'other-author.txt'), 'new remote work\n');
    git(other, 'add', '.'); git(other, 'commit', '-qm', 'remote advances');
    git(other, 'push', 'origin', lease.branch_name);
    const remoteHead = git(remote, 'rev-parse', `refs/heads/${lease.branch_name}`);
    config.mergeStrategy = 'pr';
    const rejectedPush = await call('POST', '/api/tickets/:id/ready', lease.id);
    assert.equal(rejectedPush.body.pending, true);
    assert.equal(db.getTicket(lease.id).stage, 'review');
    assert.equal(db.getTicket(lease.id).status, 'idle');
    assert.equal(git(remote, 'rev-parse', `refs/heads/${lease.branch_name}`), remoteHead);
    assert.match(db.getTicket(lease.id).activity.find(a => a.action === 'ready_error').detail, /stale info|rejected/);
    config.mergeStrategy = 'cherry-pick';
    console.log('PASS: real PR push refuses to replace unexpected remote branch changes');

    // Suggestions are auxiliary coder work, with no database ticket row.
    let suggestionRuns = 0;
    coderImpl = async () => { suggestionRuns++; return { text: '{"tickets":[{"title":"Suggestion","content":"Details"}]}' }; };
    await generateSuggestions(1);
    const suggestions = await call('GET', '/api/suggestions', null);
    assert.equal(suggestionRuns, 1); assert.equal(suggestions.body[0].title, 'Suggestion');
    console.log('PASS: auxiliary suggestion generation works without a ticket row');
  } finally {
    db.close();
    fs.rmSync(fixture, { recursive: true, force: true });
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
