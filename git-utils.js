const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { runProcess } = require('./process-runner');
const config = require('./config');
const { escShell } = require('./helpers');

function runGit(args, cwd) {
  return require('child_process').execSync(`git ${args}`, {
    cwd: cwd || config.projectDir,
    encoding: 'utf-8',
    timeout: config.coder.timeouts.command,
  }).trim();
}

async function execAsync(command, cwd, timeout, onSpawn) {
  const result = await runProcess('bash', ['-lc', command], { cwd, timeoutMs: timeout, onSpawn });
  if (result.stdoutTruncated || result.stderrTruncated) throw new Error('Command output exceeded the capture limit; result is incomplete');
  if (result.exitCode === 0 && !result.error && !result.cancelled && !result.timedOut) return result.stdout.trim();
  throw new Error((result.stderr || result.stdout).trim() || result.error?.message ||
    (result.timedOut ? 'Command timed out' : `Command exited with code ${result.exitCode}`));
}

function gitArgs(args, cwd, input) {
  return execFileSync('git', args, {
    cwd: cwd || config.projectDir, encoding: 'utf-8',
    timeout: config.coder.timeouts.command, input,
  }).trim();
}

// Build a squash commit without rewinding the ticket branch first. Agent-made
// commits, untracked files and legacy tickets without a saved base all work.
function prepareReadyCommit(ticket) {
  const cwd = ticket.worktree_path;
  const branchRef = `refs/heads/${ticket.branch_name}`;
  if (gitArgs(['symbolic-ref', 'HEAD'], cwd) !== branchRef) {
    throw new Error(`Worktree is not on ticket branch ${ticket.branch_name}; restore that branch before Ready`);
  }
  const originalHead = gitArgs(['rev-parse', 'HEAD'], cwd);
  gitArgs(['add', '-A'], cwd);
  const tree = gitArgs(['write-tree'], cwd);
  const headTree = gitArgs(['rev-parse', 'HEAD^{tree}'], cwd);
  if (config.mergeStrategy === 'pr') {
    if (tree === headTree) return originalHead;
    gitArgs(['commit', '-m', `${ticket.id}: ${ticket.title}`], cwd);
    return gitArgs(['rev-parse', 'HEAD'], cwd);
  }
  const base = ticket.base_sha || resolveDiffBase(cwd, ticket.base_branch);
  const baseSha = gitArgs(['rev-parse', `${base}^{commit}`], cwd);
  gitArgs(['merge-base', '--is-ancestor', baseSha, originalHead], cwd);
  if (tree === gitArgs(['rev-parse', `${baseSha}^{tree}`], cwd)) return null;
  const commit = gitArgs(['commit-tree', tree, '-p', baseSha], cwd, `${ticket.id}: ${ticket.title}\n`);
  gitArgs(['update-ref', branchRef, commit, originalHead], cwd);
  return commit;
}

// Fast-forward through Git's index/worktree machinery when the target is
// checked out. Git preserves compatible local changes and rejects conflicts.
// Unchecked-out branches use compare-and-swap ref updates.
function integrateBranch(cwd, branch, expectedOld, commit) {
  const ref = `refs/heads/${branch}`;
  if (gitArgs(['rev-parse', ref], cwd) !== expectedOld) {
    throw new Error(`Base branch ${branch} changed during integration; retry Ready`);
  }
  const entries = gitArgs(['worktree', 'list', '--porcelain', '-z'], cwd).split('\0\0');
  const checkouts = entries.map(entry => entry.split('\0')).filter(fields => fields.includes(`branch ${ref}`));
  if (checkouts.length > 1) throw new Error(`Branch ${branch} is checked out in multiple worktrees; integrate it manually`);
  if (checkouts.length === 1) {
    const target = checkouts[0].find(field => field.startsWith('worktree ')).slice(9);
    if (gitArgs(['symbolic-ref', 'HEAD'], target) !== ref || gitArgs(['rev-parse', 'HEAD'], target) !== expectedOld) {
      throw new Error(`Checkout of ${branch} changed during integration; retry Ready`);
    }
    gitArgs(['merge', '--ff-only', '--no-edit', commit], target);
  } else {
    gitArgs(['update-ref', ref, commit, expectedOld], cwd);
  }
  if (gitArgs(['rev-parse', ref], cwd) !== commit) throw new Error(`Could not verify integration into ${branch}`);
}

function resolveDiffBase(worktreePath, baseBranch) {
  const base = baseBranch || config.branchDefault;
  let best = null;
  let bestCount = Infinity;
  for (const ref of [`origin/${base}`, base]) {
    let branchPoint;
    try { branchPoint = runGit(`merge-base ${ref} HEAD`, worktreePath); } catch { continue; }
    let count;
    try { count = parseInt(runGit(`rev-list --count ${branchPoint}..HEAD`, worktreePath), 10); } catch { continue; }
    if (Number.isFinite(count) && count < bestCount) {
      bestCount = count;
      best = branchPoint;
    }
  }
  return best || base;
}

function popStashAndStage(worktreePath) {
  try { runGit(`stash pop`, worktreePath); } catch {}
  runGit(`add -A`, worktreePath);
}

function isWorktreeDirty(statusOutput) {
  return !!(statusOutput && statusOutput.trim());
}

function assertWorktreeClean(ticket, { stage, allow = false } = {}) {
  const db = require('./db');
  if (!ticket || !ticket.worktree_path) return;
  if (!fs.existsSync(path.join(ticket.worktree_path, '.git'))) return;
  let status = '';
  try {
    status = runGit(`status --porcelain`, ticket.worktree_path);
  } catch {
    return;
  }
  if (!allow && isWorktreeDirty(status)) {
    db.logActivity(ticket.id, 'worktree_uncommitted',
      `After ${stage}: ${status.slice(0, 200).replace(/\n/g, ' | ')}`);
  }
}

function getBranchStaleness(worktreePath, baseBranch) {
  if (!worktreePath || !fs.existsSync(path.join(worktreePath, '.git'))) return null;
  const base = baseBranch || config.branchDefault;
  try {
    const count = runGit(`rev-list --count HEAD..${base}`, worktreePath);
    return parseInt(count, 10) || 0;
  } catch {
    return null;
  }
}

function commitWorktreeChanges(worktreePath, ticketId, message, { partial = false } = {}) {
  const db = require('./db');
  const tag = partial ? 'commit_partial' : 'commit';
  try {
    const status = runGit(`status --porcelain`, worktreePath);
    if (!status) {
      db.logActivity(ticketId, 'commit_skipped', 'no uncommitted changes in worktree');
      return null;
    }
    runGit(`add -A`, worktreePath);
    runGit(`commit -m "${escShell(message)}"`, worktreePath);
    const sha = runGit(`rev-parse HEAD`, worktreePath);
    db.logActivity(ticketId, tag, `${sha.slice(0, 7)}: ${message.replace(/"/g, '')}`);
    return sha;
  } catch (err) {
    db.logActivity(ticketId, 'commit_failed', err.message.slice(0, 200));
    return null;
  }
}

module.exports = {
  runGit,
  execAsync,
  prepareReadyCommit,
  integrateBranch,
  resolveDiffBase,
  popStashAndStage,
  isWorktreeDirty,
  assertWorktreeClean,
  getBranchStaleness,
  commitWorktreeChanges,
};
