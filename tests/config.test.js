// tests/config.test.js — Config loader unit tests

const path = require('path');
const fs = require('fs');

// Reload config fresh for each test by clearing require cache
function reloadConfig() {
  delete require.cache[require.resolve('../config')];
  return require('../config');
}

let assert;
try { assert = require('assert'); } catch { assert = require('node:assert'); }

// ── config.json loading ────────────────────────────────────
(function testConfigJsonLoaded() {
  const cfg = reloadConfig();
  assert.ok(cfg.port > 0, 'port should be positive');
  assert.ok(typeof cfg.projectName === 'string', 'projectName should be a string');
  assert.ok(typeof cfg.projectDir === 'string', 'projectDir should be a string');
  assert.ok(typeof cfg.coder.type === 'string', 'coder.type should be a string');
  assert.ok(typeof cfg.coder.bin === 'string', 'coder.bin should be a string');
  console.log('PASS: config.json loaded with all required fields');
})();

// ── Convenience helpers exist ──────────────────────────────
(function testHelpers() {
  const cfg = reloadConfig();
  assert.strictEqual(typeof cfg.venvBin, 'function', 'venvBin should be a function');
  assert.strictEqual(typeof cfg.venvPython, 'function', 'venvPython should be a function');
  assert.strictEqual(typeof cfg.ticketContextDir, 'function', 'ticketContextDir should be a function');
  console.log('PASS: convenience helpers exist');
})();

// ── ticketContextDir sanitizes input ───────────────────────
(function testTicketContextDirSanitization() {
  const cfg = reloadConfig();
  const dir = cfg.ticketContextDir('hello/world test@#$');
  // The last path component should be the sanitized ticket ID
  const lastPart = require('path').basename(dir);
  assert.ok(!lastPart.includes('/'), 'should sanitize slashes from ticket id');
  assert.ok(!lastPart.includes('@'), 'should sanitize @');
  assert.ok(!lastPart.includes('#'), 'should sanitize #');
  assert.ok(!lastPart.includes('$'), 'should sanitize $');
  assert.ok(lastPart.includes('hello_world_test'), 'should keep alphanumeric + underscore');
  console.log('PASS: ticketContextDir sanitizes input');
})();

// ── worktreesDir defaults to projectDir/.worktrees ─────────
(function testWorktreesDirDefault() {
  const cfg = reloadConfig();
  const expected = path.join(cfg.projectDir, '.worktrees');
  assert.strictEqual(cfg.worktreesDir, expected, 'worktreesDir should default to projectDir/.worktrees');
  console.log('PASS: worktreesDir defaults correctly');
})();

// ── dataDir is resolved absolute ───────────────────────────
(function testDataDirAbsolute() {
  const cfg = reloadConfig();
  assert.ok(path.isAbsolute(cfg.dataDir), 'dataDir should be absolute');
  console.log('PASS: dataDir is resolved absolute');
})();

console.log('\n✅ All config tests passed\n');
