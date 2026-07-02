// tests/worktree-pool.test.js — unit tests for the worktree pool primitives.
// Exercises provisioning idempotency and acquire/release against a real
// throwaway git repo, mirroring the style of git-workflow.test.js.

let assert;
try { assert = require('assert'); } catch { assert = require('node:assert'); }

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const pool = require('../worktree-pool');

function sh(cmd, cwd) {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

function makeRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-pool-test-'));
  sh('git init -q -b main', tmp);
  sh('git config user.email test@test.local', tmp);
  sh('git config user.name test', tmp);
  sh('git config commit.gpgsign false', tmp);
  fs.writeFileSync(path.join(tmp, 'README.md'), 'main v1\n');
  sh('git add README.md', tmp);
  sh('git commit -q -m "v1"', tmp);
  return tmp;
}

function cleanupRepo(repoDir) {
  try { sh('git worktree prune', repoDir); } catch {}
  fs.rmSync(repoDir, { recursive: true, force: true });
}

// Count how many worktrees git tracks for a repo (excluding the main checkout).
function linkedWorktrees(repo) {
  return sh('git worktree list --porcelain', repo)
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length))
    .filter((p) => path.resolve(p) !== path.resolve(repo));
}

// ── provisionPool is idempotent and creates exactly `count` slots ──
(function testProvisionIsIdempotent() {
  const repo = makeRepo();
  const worktreesDir = path.join(repo, '.worktrees');
  try {
    const r1 = pool.provisionPool({ projectDir: repo, worktreesDir, branchDefault: 'main', count: 3 });
    assert.strictEqual(r1.created.length, 3, 'first run creates 3 slots');
    assert.strictEqual(r1.kept.length, 0, 'first run keeps nothing');
    assert.strictEqual(linkedWorktrees(repo).length, 3, 'git tracks 3 linked worktrees');
    for (let i = 0; i < 3; i++) {
      const wt = path.join(worktreesDir, `pool-${i}`);
      assert.ok(pool.isValidWorktree(wt), `pool-${i} is a valid worktree`);
      // Idle slot must be on a detached HEAD (so multiple can coexist).
      const head = sh('git rev-parse --abbrev-ref HEAD', wt);
      assert.strictEqual(head, 'HEAD', `pool-${i} idles on detached HEAD`);
    }

    // Second run with the same count is a no-op: everything kept, nothing new.
    const r2 = pool.provisionPool({ projectDir: repo, worktreesDir, branchDefault: 'main', count: 3 });
    assert.strictEqual(r2.created.length, 0, 'second run creates nothing (idempotent)');
    assert.strictEqual(r2.kept.length, 3, 'second run keeps all 3');
    assert.strictEqual(linkedWorktrees(repo).length, 3, 'still exactly 3 worktrees');

    console.log('PASS: provisionPool is idempotent and creates exactly `count` detached slots');
  } finally {
    cleanupRepo(repo);
  }
})();

// ── Shrinking the count removes extra slots; growing adds them ──
(function testProvisionGrowsAndShrinks() {
  const repo = makeRepo();
  const worktreesDir = path.join(repo, '.worktrees');
  try {
    pool.provisionPool({ projectDir: repo, worktreesDir, branchDefault: 'main', count: 4 });
    assert.strictEqual(linkedWorktrees(repo).length, 4, 'start with 4');

    const shrink = pool.provisionPool({ projectDir: repo, worktreesDir, branchDefault: 'main', count: 2 });
    assert.strictEqual(shrink.removed.length, 2, 'shrink removes 2');
    assert.strictEqual(linkedWorktrees(repo).length, 2, 'down to 2');
    assert.ok(!fs.existsSync(path.join(worktreesDir, 'pool-2')), 'pool-2 dir gone');
    assert.ok(!fs.existsSync(path.join(worktreesDir, 'pool-3')), 'pool-3 dir gone');

    const grow = pool.provisionPool({ projectDir: repo, worktreesDir, branchDefault: 'main', count: 3 });
    assert.strictEqual(grow.kept.length, 2, 'grow keeps the 2 existing');
    assert.strictEqual(grow.created.length, 1, 'grow adds 1');
    assert.strictEqual(linkedWorktrees(repo).length, 3, 'now 3');

    console.log('PASS: provisionPool grows and shrinks to match count');
  } finally {
    cleanupRepo(repo);
  }
})();

// ── acquireSlot checks out a feature branch; releaseSlot returns to idle ──
(function testAcquireAndRelease() {
  const repo = makeRepo();
  const worktreesDir = path.join(repo, '.worktrees');
  try {
    pool.provisionPool({ projectDir: repo, worktreesDir, branchDefault: 'main', count: 2 });
    const wt = path.join(worktreesDir, 'pool-0');
    const branchName = 'feature/my-ticket-abc';

    // Acquire: worktree ends up on the fresh feature branch, clean.
    pool.acquireSlot({ worktreePath: wt, branchDefault: 'main', branchName });
    assert.strictEqual(sh('git rev-parse --abbrev-ref HEAD', wt), branchName,
      'acquired slot is on the feature branch');
    assert.strictEqual(sh('git status --porcelain', wt), '', 'acquired slot is clean');

    // Simulate a ticket doing work and committing.
    fs.writeFileSync(path.join(wt, 'ticket-work.txt'), 'implemented\n');
    sh('git add -A', wt);
    sh('git commit -q -m "ticket work"', wt);
    assert.ok(fs.existsSync(path.join(wt, 'ticket-work.txt')), 'work file present');

    // Also leave some uncommitted junk to prove release cleans it.
    fs.writeFileSync(path.join(wt, 'scratch.txt'), 'junk\n');

    // Release: back to detached main, feature branch gone, tree pristine.
    pool.releaseSlot({ worktreePath: wt, branchDefault: 'main', branchName });
    assert.strictEqual(sh('git rev-parse --abbrev-ref HEAD', wt), 'HEAD',
      'released slot is back on detached HEAD');
    assert.strictEqual(sh('git rev-parse HEAD', wt), sh('git rev-parse main', repo),
      'released slot points at main tip');
    assert.strictEqual(sh('git status --porcelain', wt), '', 'released slot is clean');
    assert.ok(!fs.existsSync(path.join(wt, 'ticket-work.txt')), 'committed work gone from tree');
    assert.ok(!fs.existsSync(path.join(wt, 'scratch.txt')), 'uncommitted junk cleaned');
    const branches = sh('git branch --list ' + branchName, repo);
    assert.strictEqual(branches, '', 'feature branch deleted on release');

    // The slot is reusable: acquiring again for a different ticket works.
    pool.acquireSlot({ worktreePath: wt, branchDefault: 'main', branchName: 'feature/next-ticket' });
    assert.strictEqual(sh('git rev-parse --abbrev-ref HEAD', wt), 'feature/next-ticket',
      'slot is reusable for the next ticket');

    console.log('PASS: acquireSlot/releaseSlot recycle a pool slot cleanly');
  } finally {
    cleanupRepo(repo);
  }
})();

// ── isPoolWorktree recognizes only pool-N dirs under worktreesDir ──
(function testIsPoolWorktree() {
  const worktreesDir = '/tmp/proj/.worktrees';
  assert.ok(pool.isPoolWorktree(worktreesDir, '/tmp/proj/.worktrees/pool-0'), 'pool-0 recognized');
  assert.ok(pool.isPoolWorktree(worktreesDir, '/tmp/proj/.worktrees/pool-12'), 'pool-12 recognized');
  assert.ok(!pool.isPoolWorktree(worktreesDir, '/tmp/proj/.worktrees/my-ticket-x'), 'per-ticket dir not a pool slot');
  assert.ok(!pool.isPoolWorktree(worktreesDir, '/tmp/other/pool-0'), 'pool-0 elsewhere not recognized');
  assert.ok(!pool.isPoolWorktree(worktreesDir, null), 'null is not a pool slot');
  console.log('PASS: isPoolWorktree matches only <worktreesDir>/pool-N');
})();

console.log('\n✅ All worktree-pool tests passed\n');
