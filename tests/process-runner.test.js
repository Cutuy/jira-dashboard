const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { runProcess, terminateProcess } = require('../process-runner');

const quote = value => "'" + value.replace(/'/g, "'\"'\"'") + "'";
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('process result keeps exit status and bounded output with truncation evidence', async () => {
  const result = await runProcess(process.execPath, ['-e',
    "process.stdout.write('a'.repeat(200000) + 'THE END'); process.stderr.write('failed'); process.exitCode=7"],
  { timeoutMs: 2000, maxStdoutBytes: 1024 });
  assert.equal(result.exitCode, 7);
  assert.equal(result.stderr, 'failed');
  assert.equal(result.stdoutTruncated, true);
  assert.equal(Buffer.byteLength(result.stdout), 1024);
  assert.ok(result.stdout.endsWith('THE END'));
});

test('timeouts kill descendants that ignore TERM and settle without waiting for their work', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-process-tree-'));
  const marker = path.join(dir, 'late-write');
  const child = path.join(dir, 'child.cjs');
  fs.writeFileSync(child, `process.on('SIGTERM', () => {}); console.log('child ready'); setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'late'), 1000);`);
  try {
    const result = await runProcess('bash', ['-lc', `${quote(process.execPath)} ${quote(child)} & wait`], { timeoutMs: 150 });
    assert.equal(result.timedOut, true);
    assert.ok(result.stdout.includes('child ready'));
    assert.ok(result.durationMs < 950, `timeout took ${result.durationMs}ms`);
    await wait(1100);
    assert.equal(fs.existsSync(marker), false, 'a surviving test descendant wrote after timeout');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('external termination waits for cancellation settlement', async () => {
  let proc;
  let stopping;
  const done = runProcess(process.execPath, ['-e', "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)"], {
    timeoutMs: 2000,
    onSpawn(child) { proc = child; },
    onStdout() { stopping = terminateProcess(proc); },
  });
  const result = await done;
  await stopping;
  assert.equal(result.cancelled, true);
  assert.equal(result.signal, 'SIGKILL');
});

test('graceful cancellation drains final output even when the process exits zero', async () => {
  const controller = new AbortController();
  const result = await runProcess(process.execPath, ['-e',
    "process.on('SIGTERM', () => { console.log('stopped gracefully'); process.exitCode=0; clearInterval(timer); }); const timer=setInterval(() => {},1000); console.log('ready');"], {
    timeoutMs: 2000, signal: controller.signal,
    onStdout(data) { if (data.toString().includes('ready')) controller.abort(); },
  });
  assert.equal(result.cancelled, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.match(result.stdout, /stopped gracefully/);
});

test('normal parent completion also settles and terminates background descendants', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-process-complete-'));
  const ready = path.join(dir, 'ready');
  const marker = path.join(dir, 'late-write');
  const child = path.join(dir, 'child.cjs');
  fs.writeFileSync(child, `process.on('SIGTERM', () => {}); require('fs').writeFileSync(${JSON.stringify(ready)}, 'ready'); setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'late'), 1000);`);
  try {
    const command = `${quote(process.execPath)} ${quote(child)} & while [ ! -f ${quote(ready)} ]; do sleep 0.01; done`;
    const result = await runProcess('bash', ['-lc', command], { timeoutMs: 2000 });
    assert.equal(result.exitCode, 0);
    assert.equal(result.timedOut, false);
    assert.ok(result.durationMs < 950, `completion took ${result.durationMs}ms`);
    await wait(1100);
    assert.equal(fs.existsSync(marker), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('spawn failures and pre-aborted launches settle explicitly', async () => {
  const missing = await runProcess('/definitely/missing/jira-cli', [], { timeoutMs: 1000 });
  assert.equal(missing.error.code, 'ENOENT');
  const controller = new AbortController();
  controller.abort();
  let spawned = false;
  const result = await runProcess(process.execPath, ['-e', 'process.exit(0)'], {
    signal: controller.signal, onSpawn() { spawned = true; },
  });
  assert.equal(result.cancelled, true);
  assert.equal(spawned, false);
});
