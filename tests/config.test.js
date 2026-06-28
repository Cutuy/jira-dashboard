// tests/config.test.js — Config loader unit tests

const path = require('path');
const fs = require('fs');

// Reload config fresh for each test by clearing require cache
function reloadConfig() {
  delete require.cache[require.resolve('../config')];
  return require('../config');
}

// Helpers to save/restore .env around tests that need clean defaults
const envPath = path.resolve(__dirname, '..', '.env');
function withoutEnv(fn) {
  let orig = null;
  if (fs.existsSync(envPath)) orig = fs.readFileSync(envPath, 'utf-8');
  try {
    if (orig !== null) fs.unlinkSync(envPath);
    fn();
  } finally {
    if (orig !== null) fs.writeFileSync(envPath, orig, 'utf-8');
  }
}
function withEnv(content, fn) {
  let orig = null;
  if (fs.existsSync(envPath)) orig = fs.readFileSync(envPath, 'utf-8');
  try {
    fs.writeFileSync(envPath, content, 'utf-8');
    fn();
  } finally {
    if (orig !== null) fs.writeFileSync(envPath, orig, 'utf-8');
    else fs.unlinkSync(envPath);
  }
}

// Helper to save/restore config.json
const configJsonPath = path.resolve(__dirname, '..', 'config.json');
function withConfigJson(modify, fn) {
  const orig = JSON.parse(fs.readFileSync(configJsonPath, 'utf-8'));
  try {
    fs.writeFileSync(configJsonPath, JSON.stringify(modify(orig), null, 2) + '\n', 'utf-8');
    fn();
  } finally {
    fs.writeFileSync(configJsonPath, JSON.stringify(orig, null, 2) + '\n', 'utf-8');
  }
}

let assert;
try { assert = require('assert'); } catch { assert = require('node:assert'); }

// ── Tests that require clean defaults (no .env interference) ──
withoutEnv(() => {

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
  assert.ok(cfg.explorer && typeof cfg.explorer.url === 'string', 'explorer.url should be a string');
  assert.ok(cfg.explorer.url.includes('{sha}'), 'explorer.url should be a template with {sha}');
  assert.strictEqual(cfg.branchDefault, 'main', 'branchDefault should default to main');
  assert.strictEqual(cfg.dbBusyTimeout, 5000, 'dbBusyTimeout should default to 5000');
  assert.strictEqual(cfg.projectName, 'My Project', 'projectName should come from config.json');
  assert.strictEqual(cfg.projectDir, '/path/to/your/project', 'projectDir should come from config.json');
  console.log('PASS: new config fields have correct defaults');
})();

}); // withoutEnv

// ── Env var overrides via .env file ─────────────────────────
(function testEnvVarOverrides() {
  withEnv([
    'REMOTE_HOST=my-host',
    'EXPLORER_URL={protocol}//{host}:3000/explorer/{prefix}/{path}',
    'GITHUB_OWNER=my-org',
    'GITHUB_REPO=my-repo',
    'GIT_DEFAULT_BRANCH=develop',
    'DB_BUSY_TIMEOUT=9999',
    'JIRA_PROJECT_NAME=EnvProject',
    'JIRA_PROJECT_DIR=/env/path',
    'JIRA_TEST_TIMEOUT=123456',
  ].join('\n'), () => {
    const cfg = reloadConfig();
    assert.strictEqual(cfg.remoteHost, 'my-host', 'remoteHost should be overridden by .env');
    assert.strictEqual(cfg.explorer.url, '{protocol}//{host}:3000/explorer/{prefix}/{path}', 'explorer.url should be overridden by .env');
    assert.strictEqual(cfg.explorer.owner, 'my-org', 'explorer.owner should be overridden by .env');
    assert.strictEqual(cfg.explorer.repo, 'my-repo', 'explorer.repo should be overridden by .env');
    assert.strictEqual(cfg.branchDefault, 'develop', 'branchDefault should be overridden by .env');
    assert.strictEqual(cfg.dbBusyTimeout, 9999, 'dbBusyTimeout should be overridden by .env');
    assert.strictEqual(cfg.projectName, 'EnvProject', 'projectName should be overridden by .env');
    assert.strictEqual(cfg.projectDir, '/env/path', 'projectDir should be overridden by .env');
    assert.strictEqual(cfg.test.timeout, 123456, 'test.timeout should be overridden by .env');
    console.log('PASS: env vars override config defaults');
  });
})();

// ── config.json overrides take effect when .env is absent ──
(function testConfigJsonOverrides() {
  withoutEnv(() => {
    withConfigJson(
      orig => ({ ...orig, remoteHost: 'json-host', explorer: { url: 'https://github.com/json-org/json-repo/blob/{sha}/{path}', owner: 'json-org', repo: 'json-repo' }, branchDefault: 'staging', dbBusyTimeout: 1234 }),
      () => {
        const cfg = reloadConfig();
        assert.strictEqual(cfg.remoteHost, 'json-host', 'remoteHost should be overridable via config.json');
        assert.strictEqual(cfg.explorer.url, 'https://github.com/json-org/json-repo/blob/{sha}/{path}', 'explorer.url should be overridable via config.json');
        assert.strictEqual(cfg.explorer.owner, 'json-org', 'explorer.owner should be overridable via config.json');
        assert.strictEqual(cfg.explorer.repo, 'json-repo', 'explorer.repo should be overridable via config.json');
        assert.strictEqual(cfg.branchDefault, 'staging', 'branchDefault should be overridable via config.json');
        assert.strictEqual(cfg.dbBusyTimeout, 1234, 'dbBusyTimeout should be overridable via config.json');
        console.log('PASS: new fields can be set via config.json');
      }
    );
  });
})();

// ── .env wins over config.json when both define the same key ──
(function testEnvWinsOverConfigJson() {
  withConfigJson(
    orig => ({ ...orig, remoteHost: 'from-json', explorer: { url: 'from-json', owner: 'json', repo: 'repo' } }),
    () => {
      withEnv('REMOTE_HOST=from-env\nEXPLORER_URL=from-env-url', () => {
        const cfg = reloadConfig();
        assert.strictEqual(cfg.remoteHost, 'from-env', '.env should take precedence over config.json');
        assert.strictEqual(cfg.explorer.url, 'from-env-url', 'explorer.url should prefer .env over config.json');
        console.log('PASS: .env overrides config.json when both define the same field');
      });
    }
  );
})();

console.log('\n✅ All config tests passed\n');
