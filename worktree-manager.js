// worktree-manager.js — ticket ⇄ worktree lifecycle.
//
// Bridges the pure git primitives in worktree-pool.js with the ticket DB and
// config, and hides the pool-vs-per-ticket decision behind three functions
// (acquire / release / isValidWorktree) so server.js never has to branch on
// config.numWorktrees or reach into the pool directly.
//
//   config.numWorktrees > 0  → pooled mode: tickets check out one of the
//                              pre-created pool slots and return it on close.
//   config.numWorktrees == 0 → per-ticket mode: one throwaway worktree per
//                              ticket, created on acquire, deleted on release.

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const config = require('./config');
const db = require('./db');
const pool = require('./worktree-pool');

// Thrown by acquire() in pooled mode when no slot is free. server.js maps this
// to an HTTP 409 rather than treating it as an implementation failure.
class PoolFullError extends Error {
  constructor(count) {
    super(`All ${count} worktree slots are in use. Finish or close another ticket first.`);
    this.name = 'PoolFullError';
    this.code = 'POOL_FULL';
  }
}

function isPoolMode() {
  return config.numWorktrees > 0;
}

// A worktree directory is usable (has a `.git` entry).
function isValidWorktree(wt) {
  return pool.isValidWorktree(wt);
}

// True when `wt` is one of the pre-created pool slots (<worktreesDir>/pool-N).
function isPoolWorktree(wt) {
  return pool.isPoolWorktree(config.worktreesDir, wt);
}

function safeId(ticketId) {
  return String(ticketId).replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
}

function branchNameFor(ticketId) {
  return `feature/${safeId(ticketId)}`;
}

// Creating a per-ticket worktree writes a full working tree and may check out
// a remote-tracking tip far ahead of local state — as costly as
// the pool's initial `worktree add`. Give that one call the same generous
// ceiling the pool uses (worktree-pool ADD_TIMEOUT) rather than the 30s command
// default, or a big monorepo checkout hits ETIMEDOUT.
const WORKTREE_ADD_TIMEOUT = 900_000; // 15 min
const FETCH_TIMEOUT = 600_000; // 10 min

// git in the main checkout (or a given worktree). Mirrors server.js's runGit
// timeout by default, but with a large buffer so big `git worktree list` /
// status output can't overflow (ENOBUFS). Pass `timeout` to override for
// operations (like `worktree add`) that legitimately run longer.
function git(args, cwd, timeout = config.coder.timeouts.command) {
  return execSync(`git ${args}`, {
    cwd: cwd || config.projectDir,
    encoding: 'utf-8',
    timeout,
    maxBuffer: 256 * 1024 * 1024,
  }).trim();
}

function ensureWorktreesDir() {
  if (!fs.existsSync(config.worktreesDir)) {
    fs.mkdirSync(config.worktreesDir, { recursive: true });
  }
}

// Pool reset/checkout yields to the event loop. Keep a ticket's acquire and
// release ordered so a late release cannot erase a subsequent acquisition.
const ticketOperations = new Map();
function withTicketOperation(ticketId, operation) {
  const previous = ticketOperations.get(ticketId) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  ticketOperations.set(ticketId, current);
  return current.finally(() => {
    if (ticketOperations.get(ticketId) === current) ticketOperations.delete(ticketId);
  });
}

function acquisitionBase(ticket, branchName) {
  const branchDefault = ticket.base_branch || config.branchDefault;
  const defaultRef = pool.freshDefaultBase({ cwd: config.projectDir, branchDefault });
  if (!ticket.branch_name) {
    const baseSha = git(`rev-parse ${defaultRef}^{commit}`);
    return { startRef: baseSha, baseSha };
  }

  // A released ticket retains its branch name after opening a PR. Restore
  // that exact remote branch, in both allocation modes. A failed fetch must
  // stop rework before a fresh default-based branch can replace its contents.
  try {
    git(`fetch origin +refs/heads/${branchName}:refs/remotes/origin/${branchName}`,
      config.projectDir, FETCH_TIMEOUT);
    const startRef = git(`rev-parse origin/${branchName}^{commit}`);
    const baseSha = ticket.base_sha || git(`merge-base ${defaultRef} ${startRef}`);
    return { startRef, baseSha };
  } catch (error) {
    throw new Error(`Cannot restore existing feature branch ${branchName}: ${error.message}`);
  }
}

// Claim a free pool slot for a ticket and check out its feature branch.
// Returns { worktreePath, branchName } or null when every slot is in use.
async function acquirePoolSlot(ticket, branchName) {
  let preparationError;
  for (const wt of pool.poolPaths(config.worktreesDir, config.numWorktrees)) {
    if (!pool.isValidWorktree(wt)) continue;        // not provisioned — skip
    if (!db.claimWorktree(ticket.id, wt)) continue;

    let baseSha;
    const branchDefault = ticket.base_branch || config.branchDefault;
    try {
      const base = acquisitionBase(ticket, branchName);
      await pool.acquireSlot({ worktreePath: wt, branchDefault, branchName, startRef: base.startRef });
      baseSha = base.baseSha;
    } catch (e) {
      preparationError = e;
      // Keep the reservation if cleanup fails: an unreset slot is not free.
      try {
        await pool.releaseSlot({ worktreePath: wt, branchDefault, branchName });
        db.releaseWorktree(ticket.id, wt);
      } catch (cleanupError) {
        db.logActivity(ticket.id, 'cleanup_warn', cleanupError.message.slice(0, 500));
      }
      console.log(`[acquirePoolSlot] ${ticket.id} slot ${wt} FAILED: ${e.message}`);
      db.logActivity(ticket.id, 'worktree_acquire_warn',
        `slot ${wt} failed to prep: ${e.message.slice(0, 500)}`);
      continue;
    }
    return { worktreePath: wt, branchName, baseSha };
  }
  if (preparationError) throw preparationError;
  return null;
}

// Set up (or reuse) a worktree for a ticket and record it on the ticket row.
// Returns { worktreePath, branchName }. Throws PoolFullError in pooled mode
// when no slot is free.
async function acquire(ticket) {
  return withTicketOperation(ticket.id, () => acquireTicket(db.getTicket(ticket.id) || ticket));
}

async function acquireTicket(ticket) {
  ensureWorktreesDir();
  const branchName = ticket.branch_name || branchNameFor(ticket.id);
  let worktreePath;
  let baseSha = ticket.base_sha;

  if (isPoolMode()) {
    // Reuse this ticket's slot if it still holds one (e.g. a review →
    // re-implement cycle), otherwise claim a free slot. The pool size caps
    // how many tickets can be in flight at once.
    if (pool.isValidWorktree(ticket.worktree_path) && ticket.branch_name) {
      worktreePath = ticket.worktree_path;
      if (!db.claimWorktree(ticket.id, worktreePath)) throw new Error('Worktree is owned by another ticket');
      console.log(`[acquire] ${ticket.id} reusing existing worktree ${worktreePath} branch=${ticket.branch_name}`);
      // Ensure the worktree is on the expected branch — it may have drifted
      // (e.g. the slot was re-assigned to another ticket, or a manual git
      // checkout changed branches). Use plain checkout (no -B) to preserve
      // existing commits on the branch.
      git(`checkout ${ticket.branch_name}`, worktreePath);
    } else {
      if (ticket.worktree_path && !pool.isValidWorktree(ticket.worktree_path)) {
        db.releaseWorktree(ticket.id, ticket.worktree_path);
      }
      console.log(`[acquire] ${ticket.id} acquiring new pool slot...`);
      const slot = await acquirePoolSlot(ticket, branchName);
      if (!slot) throw new PoolFullError(config.numWorktrees);
      worktreePath = slot.worktreePath;
      db.logActivity(ticket.id, 'worktree_acquired', worktreePath);
      console.log(`[acquire] ${ticket.id} acquired ${worktreePath} base_sha=${slot.baseSha}`);
      // Persist the base SHA at acquire time so the ready handler can squash
      // against the exact origin/<default> commit that was used as the branch
      // point, rather than computing a merge-base against a potentially stale
      // local ref at PR time.
      baseSha = slot.baseSha;
    }
  } else {
    // Per-ticket mode: one throwaway worktree per ticket, deleted on close.
    worktreePath = path.join(config.worktreesDir, safeId(ticket.id));
    const dirHere = fs.existsSync(worktreePath);
    const tracked = (() => {
      try { return git('worktree list').includes(worktreePath); }
      catch { return false; }
    })();
    console.log(`[implement] ${ticket.id} dirHere=${dirHere} tracked=${tracked} path=${worktreePath}`);

    if (!(dirHere && tracked)) {
      // Resolve saved PR state before deleting stale local state. Fetch errors
      // leave the ticket unchanged and visible as an acquisition failure.
      const base = acquisitionBase(ticket, branchName);
      // Clean up any orphan directory (left over from a crashed previous run)
      // so `git worktree add` can create a fresh linked worktree.
      if (dirHere) fs.rmSync(worktreePath, { recursive: true, force: true });

      // Drop any stale branch from a previous attempt.
      try { git(`branch -D ${branchName}`); } catch { /* no stale branch */ }

      // Create the worktree with a fresh branch off the default branch in one
      // step. This NEVER touches the main checkout's working tree — it's a
      // metadata operation that writes a new branch ref and worktree dir. Use
      // the existing remote-tracking default ref when present; acquisitionBase
      // explicitly fetches only when restoring a previously pushed PR branch.
      git(`worktree add -b ${branchName} ${worktreePath} ${base.startRef}`, undefined, WORKTREE_ADD_TIMEOUT);
      baseSha = base.baseSha;
    }
  }

  if (!baseSha) {
    const base = pool.freshDefaultBase({ cwd: worktreePath, branchDefault: ticket.base_branch || config.branchDefault });
    baseSha = git(`merge-base HEAD ${base}`, worktreePath);
  }
  db.updateTicket(ticket.id, { worktree_path: worktreePath, branch_name: branchName, base_sha: baseSha });
  db.logActivity(ticket.id, 'worktree_created', worktreePath);
  return { worktreePath, branchName };
}

// Resolve the existing remote-tracking default ref, falling back to the local
// branch. This wrapper supplies configuration and does not fetch; see
// worktree-pool.freshDefaultBase for the rationale.
function freshDefaultBase(cwd, baseBranch) {
  return pool.freshDefaultBase({ cwd, branchDefault: baseBranch || config.branchDefault });
}

// Detach a ticket from its worktree when it closes or is deleted. Pooled slots
// are reset and returned to the pool (never removed); per-ticket worktrees are
// removed along with their branch. A pool slot remains reserved if reset or
// detach fails, so another ticket cannot acquire an incompletely cleaned slot.
async function release(ticketId) {
  return withTicketOperation(ticketId, () => releaseTicket(ticketId));
}

async function releaseTicket(ticketId) {
  const t = db.getTicket(ticketId);
  if (!t) return;
  const wt = t.worktree_path;
  const bn = t.branch_name;

  if (isPoolMode() && isPoolWorktree(wt)) {
    if (!db.claimWorktree(ticketId, wt)) throw new Error('Worktree has conflicting ticket owners; refusing cleanup');
    const branchDefault = t.base_branch || config.branchDefault;
    await pool.releaseSlot({ worktreePath: wt, branchDefault, branchName: bn });
    db.releaseWorktree(ticketId, wt);
    db.logActivity(ticketId, 'worktree_released', wt || '(none)');
    return;
  }

  if (wt) {
    try { git(`worktree remove --force ${wt}`); }
    catch (e) { db.logActivity(ticketId, 'cleanup_warn', `worktree remove failed (non-fatal): ${e.message}`); }
  }
  if (bn) {
    try { git(`branch -D ${bn}`); }
    catch (e) { db.logActivity(ticketId, 'cleanup_warn', `branch delete failed (non-fatal): ${e.message}`); }
  }
  if (wt && fs.existsSync(wt)) {
    try { fs.rmSync(wt, { recursive: true, force: true }); }
    catch (e) { db.logActivity(ticketId, 'cleanup_warn', `rm worktree dir failed (non-fatal): ${e.message}`); }
  }
  if (wt) db.releaseWorktree(ticketId, wt);
}

module.exports = {
  PoolFullError,
  acquire,
  release,
  freshDefaultBase,
  isValidWorktree,
  isPoolWorktree,
};
