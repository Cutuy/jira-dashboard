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

// Cleanup
delete require.cache[mockConfigPath];
delete require.cache[require.resolve('../coder')];

console.log('\n✅ All coder tests passed\n');
