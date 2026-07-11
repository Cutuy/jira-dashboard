// tests/pr-checker.test.js — PR checker unit tests

let assert;
try { assert = require('assert'); } catch { assert = require('node:assert'); }

// ── Mock child_process.exec before loading pr-checker ───────────
// Use mutable state so each test can control what gh returns.
let mockPRData = {
  state: 'OPEN',
  reviews: [{ state: 'CHANGES_REQUESTED', author: { login: 'reviewer' } }],
  comments: [],
  statusCheckRollup: [{ context: 'CI Check', state: 'FAILURE' }],
};

const mockExec = (cmd, opts, cb) => {
  if (cmd.startsWith('gh pr view')) {
    cb(null, JSON.stringify(mockPRData));
  } else if (cmd.startsWith('gh api graphql')) {
    cb(null, JSON.stringify([]));
  } else {
    cb(new Error('mock: unknown command'));
  }
};

const cpPath = require.resolve('child_process');
require.cache[cpPath] = {
  id: cpPath, filename: cpPath, loaded: true, exports: { exec: mockExec },
};

const { startPrChecker } = require('../pr-checker');

// ── Helpers ─────────────────────────────────────────────────────
let tick = 0;

function makeDb(initialTicket) {
  const tickets = {};
  if (initialTicket) tickets[initialTicket.id] = { ...initialTicket };
  return {
    getTicketIds: () => Object.keys(tickets),
    getTicket: (id) => tickets[id] || null,
    updateTicket: (id, fields) => { if (tickets[id]) Object.assign(tickets[id], fields); },
    updateTicketField: (id, field, value) => { if (tickets[id]) tickets[id][field] = value; },
    deleteQuestionsForTicket: () => {},
    logActivity: () => {},
    touchLatestActivity: () => {},
  };
}

function makeTicket(overrides) {
  return {
    id: 'test-ticket-' + (++tick),
    stage: 'pr_opened',
    pr_url: 'https://github.com/owner/repo/pull/123',
    pr_rework_needed: 0,
    status: 'idle',
    questions: [],
    ...overrides,
  };
}

const sse = () => {};

// ── Tests ───────────────────────────────────────────────────────

(async function () {

  // Test 1: runClarify returning undefined (the bug) — no crash
  await (async function testRunClarifyReturnsUndefined() {
    mockPRData = {
      state: 'OPEN',
      reviews: [{ state: 'CHANGES_REQUESTED', author: { login: 'reviewer' } }],
      comments: [],
      statusCheckRollup: [{ context: 'CI Check', state: 'FAILURE' }],
    };
    const ticket = makeTicket();
    const db = makeDb(ticket);
    let capturedTid = null;
    const brokenRunClarify = (tid) => { capturedTid = tid; /* no return — like old _runClarify bug */ };
    const pc = startPrChecker(db, { projectDir: '/tmp' }, sse, brokenRunClarify);
    await pc.recheckTicket(ticket.id);
    assert.strictEqual(capturedTid, ticket.id, 'runClarify should have been called');
    console.log('PASS: runClarify returning undefined does not crash');
  })();

  // Test 2: runClarify returning a Promise (normal case) — no crash
  await (async function testRunClarifyReturnsPromise() {
    mockPRData = {
      state: 'OPEN',
      reviews: [{ state: 'CHANGES_REQUESTED', author: { login: 'reviewer' } }],
      comments: [],
      statusCheckRollup: [{ context: 'CI Check', state: 'FAILURE' }],
    };
    const ticket = makeTicket();
    const db = makeDb(ticket);
    let capturedTid = null;
    const goodRunClarify = (tid) => { capturedTid = tid; return Promise.resolve(); };
    const pc = startPrChecker(db, { projectDir: '/tmp' }, sse, goodRunClarify);
    await pc.recheckTicket(ticket.id);
    assert.strictEqual(capturedTid, ticket.id, 'runClarify should have been called');
    console.log('PASS: runClarify returning a Promise does not crash');
  })();

  // Test 3: no runClarify (undefined) — existing guard, no crash
  await (async function testNoRunClarify() {
    mockPRData = {
      state: 'OPEN',
      reviews: [{ state: 'CHANGES_REQUESTED', author: { login: 'reviewer' } }],
      comments: [],
      statusCheckRollup: [{ context: 'CI Check', state: 'FAILURE' }],
    };
    const ticket = makeTicket();
    const db = makeDb(ticket);
    const pc = startPrChecker(db, { projectDir: '/tmp' }, sse);
    await pc.recheckTicket(ticket.id);
    console.log('PASS: no runClarify parameter does not crash');
  })();

  // Test 4: no rework needed — should NOT call runClarify
  await (async function testNoReworkNoClarifyCall() {
    mockPRData = {
      state: 'OPEN',
      reviews: [],
      comments: [],
      statusCheckRollup: [{ context: 'CI Check', state: 'SUCCESS' }],
    };
    const ticket = makeTicket();
    const db = makeDb(ticket);
    let called = false;
    const pc = startPrChecker(db, { projectDir: '/tmp' }, sse, () => { called = true; });
    await pc.recheckTicket(ticket.id);
    assert.strictEqual(called, false, 'runClarify should NOT be called when no rework needed');
    console.log('PASS: runClarify not called when no rework needed');
  })();

})().then(() => {
  console.log('\n\u2705 All PR checker tests passed');
  process.exit(0);
}).catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
