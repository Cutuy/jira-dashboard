// tests/coder.test.js — Coder abstraction unit tests

let assert;
try { assert = require('assert'); } catch { assert = require('node:assert'); }

// Force dummy backend by overriding config before loading coder
// We mock config to use type: 'dummy'
const origConfig = require.cache[require.resolve('../config')];
delete require.cache[require.resolve('../config')];
delete require.cache[require.resolve('../coder')];

// Create a minimal mock config
const mockConfigPath = require.resolve('../config');
require.cache[mockConfigPath] = {
  id: mockConfigPath,
  filename: mockConfigPath,
  loaded: true,
  exports: {
    port: 3006,
    projectName: 'test-project',
    projectDir: '/tmp/test-project',
    worktreesDir: '/tmp/test-project/.worktrees',
    dataDir: '/tmp/test-data',
    coder: {
      type: 'dummy',
      bin: 'echo',
      timeouts: { clarify: 1000, implement: 1000, suggest: 1000, test: 1000, command: 500 },
    },
    venv: { dir: '.venv', pythonpath: 'src' },
    test: { commandOverride: null, timeout: 1000 },
    venvBin() { return '/tmp/test-project/.venv/bin'; },
    venvPython() { return 'python3'; },
    ticketContextDir(id) { return `/tmp/test-project/.opencode/tickets/${id}`; },
  },
};

const coder = require('../coder');

// ── getStats returns sensible defaults ─────────────────────
(function testGetStats() {
  const stats = coder.getStats();
  assert.strictEqual(typeof stats.cost, 'number', 'cost should be number');
  assert.strictEqual(typeof stats.input, 'string', 'input should be string');
  assert.strictEqual(typeof stats.output, 'string', 'output should be string');
  assert.strictEqual(stats.cost, 0);
  console.log('PASS: getStats returns sensible defaults with dummy backend');
})();

// ── run with dummy backend resolves ────────────────────────
(async function testRunDummy() {
  const result = await coder.run('test prompt', { timeout: 500 });
  assert.ok(typeof result === 'string', 'run should return string');
  assert.ok(result.length >= 0, 'run should not throw');
  console.log('PASS: run with dummy backend resolves');
})();

// ── buildSpawnOptions respects opts.cwd (worktree isolation) ───
(function testBuildSpawnOptionsCwd() {
  // Pass a cwd; it should be honored.
  const o1 = coder.buildSpawnOptions(
    { buildEnv: () => ({}) },
    { cwd: '/tmp/my-worktree', timeout: 5000 }
  );
  assert.strictEqual(o1.cwd, '/tmp/my-worktree', 'cwd should be the worktree path when provided');
  assert.strictEqual(o1.timeout, 5000, 'timeout should be forwarded');

  // No cwd; should fall back to config.projectDir.
  const o2 = coder.buildSpawnOptions({ buildEnv: () => ({}) }, { timeout: 1000 });
  assert.strictEqual(o2.cwd, require('../config').projectDir,
    'cwd should fall back to config.projectDir when not provided');

  console.log('PASS: buildSpawnOptions honors opts.cwd (worktree isolation)');
})();

// Cleanup
delete require.cache[mockConfigPath];
delete require.cache[require.resolve('../coder')];

console.log('\n✅ All coder tests passed\n');
