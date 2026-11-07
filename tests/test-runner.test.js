const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, after } = require('node:test');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-tests-'));
const main = path.join(dir, 'main checkout');
const wt = path.join(dir, "ticket's worktree");
fs.mkdirSync(path.join(main, 'src', 'audit_fixture'), { recursive: true });
fs.mkdirSync(path.join(wt, 'src', 'audit_fixture'), { recursive: true });
const quote = value => "'" + value.replace(/'/g, "'\"'\"'") + "'";
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const config = {
  projectDir: main, projectName: 'audit_fixture',
  dataDir: path.join(dir, 'db'), dbBusyTimeout: 5000,
  venv: { pythonpath: 'src' }, venvPython: () => 'python3',
  test: { enabled: true, commandOverride: null, timeout: 2500 },
};
const configPath = require.resolve('../config');
require.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: config };
const db = require('../db');
const runner = require('../test-runner');
after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function waitFor(check) {
  const deadline = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('fixture did not become ready');
    await wait(10);
  }
}

test('Python imports use ticket sources for direct and detected named-project commands', async () => {
  fs.writeFileSync(path.join(main, 'src', 'audit_fixture', '__init__.py'), 'VALUE="main checkout"\n');
  fs.writeFileSync(path.join(wt, 'src', 'audit_fixture', '__init__.py'), 'VALUE="ticket worktree"\n');
  fs.writeFileSync(path.join(wt, 'src', 'audit_fixture', 'test.py'), 'import audit_fixture; print(audit_fixture.VALUE)\n');
  fs.writeFileSync(path.join(wt, 'pyproject.toml'), '[project]\nname="audit_fixture"\n');
  const direct = await runner.execTestCommand("python3 -c 'import audit_fixture; print(audit_fixture.VALUE)'", wt, 2000);
  assert.equal(direct.status, 'pass');
  assert.equal(direct.output.trim(), 'ticket worktree');
  const detected = runner.detectTestFramework(wt);
  const named = await runner.execTestCommand(detected.command, wt, 2000);
  assert.equal(named.status, 'pass');
  assert.equal(named.output.trim(), 'ticket worktree');
  config.venv.pythonpath = path.join(main, 'src');
  const absolute = await runner.execTestCommand(detected.command, wt, 2000);
  assert.equal(absolute.output.trim(), 'ticket worktree');
  config.venv.pythonpath = 'src';
});

test('test output stays within persistence limit and marks truncation', async () => {
  const result = await runner.execTestCommand(`${quote(process.execPath)} -e ${quote("process.stdout.write('a'.repeat(200000)); process.stderr.write('b'.repeat(200000))")}`, wt, 2000);
  assert.equal(result.status, 'pass');
  assert.ok(Buffer.byteLength(result.output) <= 64 * 1024);
  assert.match(result.output, /stdout truncated/);
  assert.match(result.output, /stderr truncated/);
});

test('one test run per ticket; stop waits for descendants and finalization before reuse', async () => {
  const ready = path.join(dir, 'ready');
  const marker = path.join(dir, 'late-write');
  const child = path.join(dir, 'long-test.cjs');
  fs.writeFileSync(child, `process.on('SIGTERM', () => {}); require('fs').writeFileSync(${JSON.stringify(ready)}, 'ready'); setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'late'), 1000);`);
  config.test.commandOverride = `${quote(process.execPath)} ${quote(child)} & wait`;
  db.createTicket({ id: 'test-owner', title: 'owner', worktree_path: wt,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  const runId = runner.runTicketTests('test-owner', 'manual');
  assert.equal(runner.runTicketTests('test-owner', 'manual'), runId);
  await waitFor(() => fs.existsSync(ready));
  const stopping = runner.stopTicketTests('test-owner');
  assert.equal(runner.runTicketTests('test-owner', 'manual'), null);
  await stopping;
  const row = db.getLatestTestRun('test-owner');
  assert.equal(row.id, runId);
  assert.equal(row.status, 'error');
  assert.match(row.output, /cancelled/);
  assert.ok(row.finished_at);
  await wait(1100);
  assert.equal(fs.existsSync(marker), false);
  config.test.commandOverride = 'true';
  const next = runner.runTicketTests('test-owner', 'manual');
  assert.notEqual(next, runId);
  await waitFor(() => db.getLatestTestRun('test-owner').status !== 'running');
  assert.equal(db.getLatestTestRun('test-owner').status, 'pass');
});

test('deleting a ticket during a test run leaves no late persistence error', async () => {
  config.test.commandOverride = `${quote(process.execPath)} -e ${quote('setTimeout(() => {}, 1000)')}`;
  db.createTicket({ id: 'deleted-owner', title: 'deleted', worktree_path: wt,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  runner.runTicketTests('deleted-owner', 'manual');
  db.deleteTicket('deleted-owner');
  await runner.stopTicketTests('deleted-owner');
  assert.equal(db.getLatestTestRun('deleted-owner'), null);
});
