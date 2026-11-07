const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function fixture(legacy) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-db-test-'));
  if (legacy) fs.writeFileSync(path.join(dataDir, 'store.json'), JSON.stringify(legacy));
  const configPath = require.resolve('../config');
  const dbPath = require.resolve('../db');
  const previousConfig = require.cache[configPath];
  const previousDb = require.cache[dbPath];
  require.cache[configPath] = { id: configPath, filename: configPath, loaded: true,
    exports: { dataDir, dbBusyTimeout: 1000 } };
  delete require.cache[dbPath];
  const db = require('../db');
  return {
    db, dataDir,
    create(id, fields = {}) {
      const now = new Date().toISOString();
      return db.createTicket({ id, title: id, created_at: now, updated_at: now, ...fields });
    },
    close() {
      db.close();
      if (previousConfig) require.cache[configPath] = previousConfig;
      else delete require.cache[configPath];
      if (previousDb) require.cache[dbPath] = previousDb;
      else delete require.cache[dbPath];
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

{
  const ctx = fixture();
  try {
    const { db, create, dataDir } = ctx;
    const ticket = create('branches', { base_branch: 'release', base_sha: 'original-base' });
    assert.strictEqual(ticket.base_branch, 'release');
    assert.strictEqual(ticket.base_sha, 'original-base');
    db.updateTicket(ticket.id, { base_branch: 'stable', base_sha: 'new-base' });
    db.updateTicket(ticket.id, { title: 'Keep saved base settings' });
    assert.strictEqual(db.getTicket(ticket.id).base_branch, 'stable');
    assert.strictEqual(db.getTicket(ticket.id).base_sha, 'new-base');
    db.updateTicket(ticket.id, { base_branch: null });
    assert.strictEqual(db.getTicket(ticket.id).base_branch, null);

    create('a');
    create('b');
    const slot = path.join(dataDir, 'pool-0');
    assert.strictEqual(db.claimWorktree('a', slot), true);
    assert.strictEqual(db.claimWorktree('b', slot), false);
    db.updateTicket('a', { stage: 'done' });
    assert.strictEqual(db.claimWorktree('b', slot), false, 'done still owns its path until cleanup');
    assert.strictEqual(db.releaseWorktree('b', slot), false, 'another ticket cannot clear the owner');
    assert.strictEqual(db.releaseWorktree('a', path.join(dataDir, 'pool-1')), false, 'stale cleanup cannot clear a different reservation');
    assert.strictEqual(db.releaseWorktree('a', slot), true);
    assert.strictEqual(db.claimWorktree('b', slot), true);
    assert.strictEqual(db.releaseWorktree('a', slot), false, 'late cleanup cannot clear a new owner');
    assert.strictEqual(db.getTicket('b').worktree_path, slot);

    const passed = db.createTestRun('b', 'shell', 'true');
    db.finalizeTestRun(passed, { status: 'pass', exit_code: 0, output: 'ok' });
    for (let i = 0; i < 25; i++) db.createTestRun('b', 'shell', 'sleep 60');
    assert.strictEqual(db.recoverInterruptedTestRuns(), 25, 'restart recovery covers all runs beyond list default');
    const runs = db.getTestRuns('b', 100);
    assert.ok(runs.filter(r => r.id !== passed).every(r =>
      r.status === 'error' && r.finished_at && /interrupted.*restart/.test(r.summary)));
    assert.strictEqual(runs.find(r => r.id === passed).status, 'pass');
    assert.strictEqual(db.recoverInterruptedTestRuns(), 0, 'recovery is idempotent');
    console.log('PASS: base settings round-trip, claims remain exclusive through cleanup, and interrupted runs recover');
  } finally { ctx.close(); }
}

{
  const created = '2025-01-01T00:00:00.000Z';
  const activityTime = '2025-01-02T00:00:00.000Z';
  const legacy = { tickets: {
    old: {
      title: 'Legacy task', content: 'existing content', created_at: created,
      questions: [{ question: 'What should change?', answer: 'Behavior', round: 2 }],
      activity: [{ action: 'clarify_done', detail: 'kept detail', time: activityTime }],
    },
    recent: {
      title: 'Newer JSON task', stage: 'review', status: 'idle', plan: 'saved plan',
      base_branch: 'release', base_sha: 'saved-base', branch_name: 'feature/recent',
      pr_url: 'https://example.test/pull/7', pr_touched_checks: ['lint'], pr_rework_needed: 1,
      token_usage: { cost: '1.25', input: '123', output: '45' },
      questions: [{ question: 'Which option?', answer: 'A', round: 3, type: 'multiple_choice', options: ['A', 'B'] }],
      activity: [{ action: 'implement_done', detail: 'saved activity', stage: 'implementation', time: activityTime }],
    },
  } };
  const ctx = fixture(legacy);
  try {
    const old = ctx.db.getTicket('old');
    assert.strictEqual(old.title, 'Legacy task');
    assert.strictEqual(old.created_at, created);
    assert.strictEqual(old.questions[0].question, 'What should change?');
    assert.strictEqual(old.questions[0].answer, 'Behavior');
    assert.strictEqual(old.questions[0].round, 2);
    assert.strictEqual(old.questions[0].type, 'free_text');
    assert.strictEqual(old.activity.length, 1, 'migration preserves history without adding a new created event');
    assert.strictEqual(old.activity[0].time, activityTime);
    assert.strictEqual(old.activity[0].stage, null);
    const recent = ctx.db.getTicket('recent');
    assert.strictEqual(recent.base_branch, 'release');
    assert.strictEqual(recent.base_sha, 'saved-base');
    assert.strictEqual(recent.pr_url, 'https://example.test/pull/7');
    assert.deepStrictEqual(recent.pr_touched_checks, ['lint']);
    assert.strictEqual(recent.pr_rework_needed, 1);
    assert.deepStrictEqual(recent.questions[0].options, ['A', 'B']);
    assert.strictEqual(recent.questions[0].type, 'multiple_choice');
    assert.strictEqual(recent.activity[0].stage, 'implementation');
    assert.strictEqual(recent.token_usage.cost, '1.25');
    assert.strictEqual(fs.existsSync(path.join(ctx.dataDir, 'store.json')), false);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(ctx.dataDir, 'store.json.migrated'), 'utf8')), legacy);
    console.log('PASS: representative legacy JSON migrates all ticket, question and activity fields');
  } finally { ctx.close(); }
}
