#!/usr/bin/env node
// install/setup-worktrees.js — idempotent worktree-pool provisioning.
//
// Invoked by install/run.sh. Takes all inputs as args so it does NOT depend on
// config.js project-dir discovery (which would mis-resolve when run from the
// dashboard source tree). Safe to run repeatedly: existing pool slots are kept,
// missing ones created, and slots beyond `count` removed.
//
// Usage:
//   node setup-worktrees.js <projectDir> <branchDefault> <count> [worktreesDir]

const path = require('path');
const pool = require('../worktree-pool');

function fail(msg) {
  console.error(`setup-worktrees: ${msg}`);
  process.exit(1);
}

const [, , projectDir, branchDefault, countArg, worktreesDirArg] = process.argv;

if (!projectDir || !branchDefault || countArg === undefined) {
  fail('usage: setup-worktrees.js <projectDir> <branchDefault> <count> [worktreesDir]');
}

const count = parseInt(countArg, 10);
if (!Number.isFinite(count) || count < 0) fail(`invalid count: ${countArg}`);

const worktreesDir = worktreesDirArg || path.join(projectDir, '.worktrees');

if (count === 0) {
  // Nothing to pre-create; still shrink away any leftover pool slots so a
  // "set back to 0" install is clean.
  const { removed } = pool.provisionPool({ projectDir, worktreesDir, branchDefault, count: 0 });
  if (removed.length) console.log(`Removed ${removed.length} stale pool slot(s).`);
  else console.log('Pool disabled (count=0); nothing to provision.');
  process.exit(0);
}

const { created, kept, removed } = pool.provisionPool({
  projectDir,
  worktreesDir,
  branchDefault,
  count,
});

console.log(`Worktree pool at ${worktreesDir} (branch: ${branchDefault})`);
if (kept.length) console.log(`  kept    ${kept.length} existing slot(s)`);
if (created.length) console.log(`  created ${created.length} new slot(s)`);
if (removed.length) console.log(`  removed ${removed.length} extra slot(s)`);
console.log(`  total   ${count} slot(s) ready`);
