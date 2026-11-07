// Exercise production ownership queries with real SQLite and disposable Git
// repositories. A board-list mock previously hid duplicate pool claims.
const assert = require('assert');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const pool = require('../worktree-pool');

function sh(cmd, cwd) {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

function makeRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-mgr-test-'));
  sh('git init -q -b main', repo);
  sh('git config user.email test@test.local', repo);
  sh('git config user.name test', repo);
  sh('git config commit.gpgsign false', repo);
  fs.writeFileSync(path.join(repo, 'README.md'), 'main v1\n');
  sh('git add README.md', repo);
  sh('git commit -q -m v1', repo);
  return repo;
}

function loadManager(repo, numWorktrees) {
  const configPath = require.resolve('../config');
  const dbPath = require.resolve('../db');
  const managerPath = require.resolve('../worktree-manager');
  const previous = [configPath, dbPath, managerPath].map(p => require.cache[p]);
  for (const p of [dbPath, managerPath]) delete require.cache[p];
  const config = {
    numWorktrees, projectDir: repo,
    dataDir: path.join(repo, '.dashboard-data'), dbBusyTimeout: 1000,
    worktreesDir: path.join(repo, '.worktrees'), branchDefault: 'main',
    coder: { timeouts: { command: 30_000 } },
  };
  require.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: config };
  const db = require('../db');
  const manager = require('../worktree-manager');
  return {
    manager, db, config,
    create(id, fields = {}) {
      const now = new Date().toISOString();
      return db.createTicket({ id, title: id, created_at: now, updated_at: now, ...fields });
    },
    close() {
      db.close();
      [configPath, dbPath, managerPath].forEach((p, i) => {
        if (previous[i]) require.cache[p] = previous[i];
        else delete require.cache[p];
      });
    },
  };
}

async function withManager(numWorktrees, test) {
  const repo = makeRepo();
  const ctx = loadManager(repo, numWorktrees);
  try { await test({ repo, ...ctx }); }
  finally { ctx.close(); fs.rmSync(repo, { recursive: true, force: true }); }
}

async function main() {
  await withManager(0, async ({ repo, manager, db, create }) => {
    const initialSha = sh('git rev-parse HEAD', repo);
    const ticket = create('abc');
    const result = await manager.acquire(ticket);
    assert.strictEqual(result.branchName, 'feature/abc');
    assert.strictEqual(result.worktreePath, path.join(repo, '.worktrees', 'abc'));
    assert.strictEqual(sh('git symbolic-ref --short HEAD', result.worktreePath), 'feature/abc');
    assert.strictEqual(db.getTicket('abc').base_sha, initialSha, 'new worktree records its exact branch point');
    await manager.release('abc');
    assert.ok(!fs.existsSync(result.worktreePath));
    assert.strictEqual(db.getTicket('abc').worktree_path, null);
    assert.strictEqual(sh('git branch --list feature/abc', repo), '');
  });
  console.log('PASS: per-ticket acquisition records its base and releases its worktree');

  await withManager(2, async ({ repo, manager, db, config, create }) => {
    pool.provisionPool({ ...config, count: 2 });
    const t1 = create('t1');
    const t2 = create('t2');
    const t3 = create('t3');
    const [a1, a2] = await Promise.all([manager.acquire(t1), manager.acquire(t2)]);
    assert.notStrictEqual(a1.worktreePath, a2.worktreePath);
    const ownedFile = path.join(a1.worktreePath, 'only-t1.txt');
    fs.writeFileSync(ownedFile, 'uncommitted work\n');
    assert.strictEqual(db.getAllTickets()[0].worktree_path, undefined, 'board projection remains abbreviated');
    await assert.rejects(manager.acquire(t3), { code: 'POOL_FULL' });
    assert.strictEqual(fs.readFileSync(ownedFile, 'utf8'), 'uncommitted work\n');
    const again = await manager.acquire(t1); // caller has the stale pre-acquire row
    assert.strictEqual(again.worktreePath, a1.worktreePath);
    assert.strictEqual(fs.readFileSync(ownedFile, 'utf8'), 'uncommitted work\n');
    assert.strictEqual(db.getTicket('t1').base_sha, sh('git rev-parse main', repo));

    // Close marks done before asynchronous release finishes. Keep its
    // reservation until reset/detach has completed.
    db.updateTicket('t1', { stage: 'done' });
    await assert.rejects(manager.acquire(t3), { code: 'POOL_FULL' });
    const realRelease = pool.releaseSlot;
    let finishRelease;
    let announceRelease;
    const releaseStarted = new Promise(resolve => { announceRelease = resolve; });
    const heldRelease = new Promise(resolve => { finishRelease = resolve; });
    pool.releaseSlot = async args => { announceRelease(); await heldRelease; return realRelease(args); };
    try {
      const releasing = manager.release('t1');
      await releaseStarted;
      await assert.rejects(manager.acquire(t3), { code: 'POOL_FULL' });
      assert.strictEqual(fs.readFileSync(ownedFile, 'utf8'), 'uncommitted work\n');
      finishRelease();
      await releasing;
    } finally { finishRelease(); pool.releaseSlot = realRelease; }
    assert.strictEqual(db.getTicket('t1').worktree_path, null);
    assert.strictEqual(sh('git rev-parse --abbrev-ref HEAD', a1.worktreePath), 'HEAD');
    const a3 = await manager.acquire(t3);
    assert.strictEqual(a3.worktreePath, a1.worktreePath);

    // Cleanup failures must not advertise a dirty slot as available.
    db.updateTicket('t2', { base_branch: 'missing-default-branch' });
    await assert.rejects(manager.release('t2'));
    assert.strictEqual(db.getTicket('t2').worktree_path, a2.worktreePath);
    const t4 = create('t4');
    await assert.rejects(manager.acquire(t4), { code: 'POOL_FULL' });
  });
  console.log('PASS: real database pool ownership survives concurrent acquisition and done/release race');

  await withManager(1, async ({ manager, db, config, create }) => {
    pool.provisionPool({ ...config, count: 1 });
    const ticket = create('owner', { worktree_path: path.join(config.worktreesDir, 'missing-slot') });
    const acquired = await manager.acquire(ticket);
    const ownedFile = path.join(acquired.worktreePath, 'still-owned.txt');
    fs.writeFileSync(ownedFile, 'keep my work\n');
    create('legacy-duplicate', { worktree_path: acquired.worktreePath, stage: 'done' });
    await assert.rejects(manager.release('legacy-duplicate'), /conflicting ticket owners/);
    assert.strictEqual(fs.readFileSync(ownedFile, 'utf8'), 'keep my work\n');
    assert.strictEqual(db.getTicket('owner').worktree_path, acquired.worktreePath);
  });
  console.log('PASS: missing reservations recover and legacy duplicate owners cannot erase another ticket');

  for (const numWorktrees of [0, 1]) {
    await withManager(numWorktrees, async ({ repo, manager, db, config, create }) => {
      const origin = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-mgr-origin-'));
      try {
        sh('git init -q --bare', origin);
        sh(`git remote add origin ${origin}`, repo);
        sh('git push -q -u origin main', repo);
        if (numWorktrees) pool.provisionPool({ ...config, count: numWorktrees });
        const ticket = create('rework');
        const first = await manager.acquire(ticket);
        const baseSha = db.getTicket(ticket.id).base_sha;
        fs.writeFileSync(path.join(first.worktreePath, 'implementation.txt'), 'original implementation\n');
        sh('git add implementation.txt', first.worktreePath);
        sh('git commit -q -m implementation', first.worktreePath);
        sh(`git push -q origin ${first.branchName}`, first.worktreePath);
        const featureSha = sh('git rev-parse HEAD', first.worktreePath);
        db.updateTicket(ticket.id, { pr_url: 'https://example.test/pull/1' });
        await manager.release(ticket.id);
        fs.writeFileSync(path.join(repo, 'new-main.txt'), 'new default work\n');
        sh('git add new-main.txt', repo);
        sh('git commit -q -m advance-main', repo);
        sh('git push -q origin main', repo);
        const restored = await manager.acquire(db.getTicket(ticket.id));
        assert.strictEqual(sh('git rev-parse HEAD', restored.worktreePath), featureSha);
        assert.strictEqual(fs.readFileSync(path.join(restored.worktreePath, 'implementation.txt'), 'utf8'), 'original implementation\n');
        assert.strictEqual(db.getTicket(ticket.id).base_sha, baseSha, 'rework keeps the original branch point');
        await manager.release(ticket.id);
        sh(`git push -q origin --delete ${first.branchName}`, repo);
        await assert.rejects(manager.acquire(db.getTicket(ticket.id)), /Cannot restore existing feature branch/);
        assert.strictEqual(db.getTicket(ticket.id).worktree_path, null, 'failed restore leaves no new ticket worktree');
      } finally { fs.rmSync(origin, { recursive: true, force: true }); }
    });
    console.log(`PASS: mode ${numWorktrees} restores PR head and fails visibly when remote branch is missing`);
  }

  await withManager(0, async ({ repo, manager }) => {
    const origin = makeRepo();
    try {
      sh(`git remote add origin ${origin}`, repo);
      sh('git fetch -q origin', repo);
      const originTip = sh('git rev-parse origin/main', repo);
      fs.writeFileSync(path.join(origin, 'upstream.txt'), 'new upstream work\n');
      sh('git add upstream.txt', origin);
      sh('git commit -q -m upstream', origin);
      assert.strictEqual(manager.freshDefaultBase(repo), 'origin/main');
      assert.strictEqual(sh('git rev-parse origin/main', repo), originTip, 'base resolution itself does not fetch');
    } finally { fs.rmSync(origin, { recursive: true, force: true }); }
  });
  console.log('PASS: freshDefaultBase preserves the existing remote-tracking contract');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
