const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, after } = require('node:test');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-coder-process-'));
const cli = path.join(dir, 'fake-coder');
const config = {
  projectDir: dir,
  coder: { type: 'codex', bin: cli },
  venv: { dir: '.venv' },
  venvBin: () => '/nonexistent',
};
const configPath = require.resolve('../config');
require.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: config };
const coder = require('../coder');
const writeCli = source => {
  fs.writeFileSync(cli, '#!' + process.execPath + '\n' + source);
  fs.chmodSync(cli, 0o700);
};
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('a failed coder rejects while preserving parsed partial output, session, stderr and code', async () => {
  writeCli([
    `console.log(JSON.stringify({type:'thread.started',thread_id:'failed-session'}));`,
    `console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'partial implementation'}}));`,
    `console.error('credentials expired'); process.exitCode=1;`,
  ].join('\n'));
  await assert.rejects(coder.run('test', { timeout: 1000 }), err => {
    assert.equal(err.exitCode, 1);
    assert.equal(err.text, 'partial implementation');
    assert.equal(err.partialResult.sessionId, 'failed-session');
    assert.match(err.stderr, /credentials expired/);
    assert.match(err.stdout, /partial implementation/);
    return true;
  });
});

test('a successful structured coder result retains its existing contract', async () => {
  writeCli(`console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'done'}}));`);
  const result = await coder.run('test', { timeout: 1000 });
  assert.equal(result.text, 'done');
});

test('overflow is an explicit partial-result failure retaining initial session and final result', async () => {
  writeCli([
    `console.log(JSON.stringify({type:'thread.started',thread_id:'long-session'}));`,
    `process.stdout.write('x'.repeat(5 * 1024 * 1024) + '\\n');`,
    `console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'final message'}}));`,
  ].join('\n'));
  let largestProgress = 0;
  await assert.rejects(coder.run('test', { timeout: 2000, onProgress(line) { largestProgress = Math.max(largestProgress, line.length); } }), err => {
    assert.equal(err.exitCode, 0);
    assert.equal(err.stdoutTruncated, true);
    assert.ok(Buffer.byteLength(err.stdout) <= 4 * 1024 * 1024);
    assert.equal(err.partialResult.sessionId, 'long-session');
    assert.equal(err.partialResult.text, 'final message');
    assert.match(err.message, /truncated/);
    return true;
  });
  assert.ok(largestProgress <= 4 * 1024 * 1024 + 64 * 1024);
});
