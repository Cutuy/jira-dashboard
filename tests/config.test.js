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

// ── New configurable fields: defaults ───────────────────────
(function testNewFieldDefaults() {
  const cfg = reloadConfig();
  assert.strictEqual(cfg.remoteHost, 'example-claw', 'remoteHost should default to example-claw');
  assert.strictEqual(cfg.explorerPort, 18802, 'explorerPort should default to 18802');
  assert.strictEqual(cfg.branchDefault, 'main', 'branchDefault should default to main');
  assert.strictEqual(cfg.dbBusyTimeout, 5000, 'dbBusyTimeout should default to 5000');
  console.log('PASS: new config fields have correct defaults');
})();

// ── Env var overrides via .env file ─────────────────────────
(function testEnvVarOverrides() {
  const envPath = path.resolve(__dirname, '..', '.env');

  // Save original .env if it exists
  let orig = null;
  if (fs.existsSync(envPath)) orig = fs.readFileSync(envPath, 'utf-8');

  try {
    fs.writeFileSync(envPath, [
      'REMOTE_HOST=my-host',
      'EXPLORER_PORT=3000',
      'GIT_DEFAULT_BRANCH=develop',
      'DB_BUSY_TIMEOUT=9999',
    ].join('\n'), 'utf-8');

    const cfg = reloadConfig();
    assert.strictEqual(cfg.remoteHost, 'my-host', 'remoteHost should be overridden by .env');
    assert.strictEqual(cfg.explorerPort, 3000, 'explorerPort should be overridden by .env');
    assert.strictEqual(cfg.branchDefault, 'develop', 'branchDefault should be overridden by .env');
    assert.strictEqual(cfg.dbBusyTimeout, 9999, 'dbBusyTimeout should be overridden by .env');

    // Sandbox: config.json should still work alongside .env for non-overridden fields
    assert.strictEqual(typeof cfg.projectName, 'string', 'projectName should still load from config.json');
    assert.strictEqual(typeof cfg.projectDir, 'string', 'projectDir should still load from config.json');
    console.log('PASS: env vars override config defaults');
  } finally {
    // Restore original .env (or remove the test one)
    if (orig !== null) {
      fs.writeFileSync(envPath, orig, 'utf-8');
    } else {
      fs.unlinkSync(envPath);
    }
  }
})();

// ── config.json overrides for new fields ────────────────────
(function testConfigJsonOverrides() {
  const configJsonPath = path.resolve(__dirname, '..', 'config.json');
  const orig = JSON.parse(fs.readFileSync(configJsonPath, 'utf-8'));

  try {
    // Add new fields to config.json for testing
    const modified = { ...orig, remoteHost: 'json-host', explorerPort: 7777, branchDefault: 'staging', dbBusyTimeout: 1234 };
    fs.writeFileSync(configJsonPath, JSON.stringify(modified, null, 2), 'utf-8');

    const cfg = reloadConfig();
    assert.strictEqual(cfg.remoteHost, 'json-host', 'remoteHost should be overridable via config.json');
    assert.strictEqual(cfg.explorerPort, 7777, 'explorerPort should be overridable via config.json');
    assert.strictEqual(cfg.branchDefault, 'staging', 'branchDefault should be overridable via config.json');
    assert.strictEqual(cfg.dbBusyTimeout, 1234, 'dbBusyTimeout should be overridable via config.json');
    console.log('PASS: new fields can be set via config.json');
  } finally {
    fs.writeFileSync(configJsonPath, JSON.stringify(orig, null, 2), 'utf-8');
  }
})();

console.log('\n✅ All config tests passed\n');
