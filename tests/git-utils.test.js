// tests/git-utils.test.js — Unit tests for git-utils functions
// that respect ticket.base_branch.

let assert;
try { assert = require('assert'); } catch { assert = require('node:assert'); }

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function sh(cmd, cwd) {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

function makeRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-git-utils-'));
  sh('git init -q -b main', tmp);
  sh('git config user.email test@test.local', tmp);
  sh('git config user.name test', tmp);
  sh('git config commit.gpgsign false', tmp);
  fs.writeFileSync(path.join(tmp, 'README.md'), 'v1\n');
  sh('git add README.md', tmp);
  sh('git commit -q -m "initial"', tmp);
  return tmp;
}

function cleanup(repoDir) {
  fs.rmSync(repoDir, { recursive: true, force: true });
}

const { resolveDiffBase, getBranchStaleness } = require('../git-utils');

// ── resolveDiffBase ───────────────────────────────────────────

(function testResolveDiffBaseDefaultsToConfigBranch() {
  const repo = makeRepo();
  try {
    // Make a commit on main so the branch has some history
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
    sh('git add a.txt', repo);
    sh('git commit -q -m "commit on main"', repo);
    const mainSha = sh('git rev-parse HEAD', repo);

    // Create a local branch that is a few commits ahead of main
    sh('git checkout -b feature/ticket', repo);
    fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n');
    sh('git add b.txt', repo);
    sh('git commit -q -m "commit on ticket"', repo);

    // resolveDiffBase with null baseBranch should fall back to config.branchDefault
    const result = resolveDiffBase(repo, null);
    assert.strictEqual(result, mainSha,
      `resolveDiffBase(null) should return the merge-base with the config default branch`);
    console.log('PASS: resolveDiffBase(null) defaults to config.branchDefault');
  } finally { cleanup(repo); }
})();

(function testResolveDiffBaseUsesCustomBranch() {
  const repo = makeRepo();
  try {
    // Create a secondary branch with some commits
    sh('git checkout -b feature/other', repo);
    fs.writeFileSync(path.join(repo, 'other.txt'), 'other\n');
    sh('git add other.txt', repo);
    sh('git commit -q -m "commit on other branch"', repo);
    const otherSha = sh('git rev-parse HEAD', repo);

    // Also add another commit on main (diverging history)
    sh('git checkout main', repo);
    fs.writeFileSync(path.join(repo, 'main.txt'), 'main\n');
    sh('git add main.txt', repo);
    sh('git commit -q -m "commit on main"', repo);
    const mainSha = sh('git rev-parse HEAD', repo);

    // Create a ticket branch off feature/other
    sh('git checkout feature/other', repo);
    sh('git checkout -b feature/ticket', repo);
    fs.writeFileSync(path.join(repo, 'ticket.txt'), 'ticket\n');
    sh('git add ticket.txt', repo);
    sh('git commit -q -m "commit on ticket"', repo);

    // resolveDiffBase with custom branch should use that branch, not main
    const result = resolveDiffBase(repo, 'feature/other');
    assert.strictEqual(result, otherSha,
      `resolveDiffBase('feature/other') should return the merge-base with feature/other`);
    // And it should NOT equal the main tip
    assert.notStrictEqual(result, mainSha,
      `resolveDiffBase('feature/other') should NOT use main`);
    console.log('PASS: resolveDiffBase(customBranch) uses the specified branch');
  } finally { cleanup(repo); }
})();

(function testResolveDiffBaseUndefinedDefaults() {
  const repo = makeRepo();
  try {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
    sh('git add a.txt', repo);
    sh('git commit -q -m "commit on main"', repo);
    const mainSha = sh('git rev-parse HEAD', repo);

    sh('git checkout -b feature/ticket', repo);
    fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n');
    sh('git add b.txt', repo);
    sh('git commit -q -m "commit on ticket"', repo);

    // Calling with no 2nd arg (undefined) should fall back to config default
    const result = resolveDiffBase(repo);
    assert.strictEqual(result, mainSha,
      `resolveDiffBase() with no baseBranch should fall back to config.branchDefault`);
    console.log('PASS: resolveDiffBase() with no 2nd arg defaults to config.branchDefault');
  } finally { cleanup(repo); }
})();

// ── getBranchStaleness ────────────────────────────────────────

(function testGetBranchStalenessDefaultsToConfigBranch() {
  const repo = makeRepo();
  try {
    sh('git checkout -b feature/ticket', repo);
    fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n');
    sh('git add b.txt', repo);
    sh('git commit -q -m "commit on ticket"', repo);

    // Add more commits to main to make the ticket branch "behind"
    sh('git checkout main', repo);
    fs.writeFileSync(path.join(repo, 'c.txt'), 'c\n');
    sh('git add c.txt', repo);
    sh('git commit -q -m "main ahead 1"', repo);
    fs.writeFileSync(path.join(repo, 'd.txt'), 'd\n');
    sh('git add d.txt', repo);
    sh('git commit -q -m "main ahead 2"', repo);

    // Checkout ticket branch to get a proper worktree
    sh('git checkout feature/ticket', repo);

    // getBranchStaleness with null should report behind relative to config default
    const count = getBranchStaleness(repo, null);
    assert.strictEqual(count, 2,
      `getBranchStaleness(null) should count commits behind config.branchDefault`);
    console.log('PASS: getBranchStaleness(null) defaults to config.branchDefault');
  } finally { cleanup(repo); }
})();

(function testGetBranchStalenessUsesCustomBranch() {
  const repo = makeRepo();
  try {
    // Create a secondary branch
    sh('git checkout -b feature/other', repo);
    fs.writeFileSync(path.join(repo, 'other.txt'), 'other\n');
    sh('git add other.txt', repo);
    sh('git commit -q -m "other"', repo);

    // Add commits to main too (to show we're NOT counting those)
    sh('git checkout main', repo);
    fs.writeFileSync(path.join(repo, 'c.txt'), 'c\n');
    sh('git add c.txt', repo);
    sh('git commit -q -m "main only"', repo);

    // Create ticket branch off feature/other and add commits
    sh('git checkout feature/other', repo);
    sh('git checkout -b feature/ticket', repo);
    fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n');
    sh('git add b.txt', repo);
    sh('git commit -q -m "ticket 1"', repo);

    // Advance feature/other further (making ticket behind OTHER, not main)
    sh('git checkout feature/other', repo);
    fs.writeFileSync(path.join(repo, 'd.txt'), 'd\n');
    sh('git add d.txt', repo);
    sh('git commit -q -m "other ahead 1"', repo);
    fs.writeFileSync(path.join(repo, 'e.txt'), 'e\n');
    sh('git add e.txt', repo);
    sh('git commit -q -m "other ahead 2"', repo);

    // Checkout ticket branch
    sh('git checkout feature/ticket', repo);

    // Should be 2 behind feature/other, not behind main at all
    const count = getBranchStaleness(repo, 'feature/other');
    assert.strictEqual(count, 2,
      `getBranchStaleness('feature/other') should count commits behind feature/other`);

    // Should NOT be behind main (there's 1 commit on main not in ticket)
    // Actually, feature/ticket IS behind main by 1 commit (the "main only" commit)
    // But we're checking specifically against feature/other
    console.log('PASS: getBranchStaleness(customBranch) counts against the specified branch');
  } finally { cleanup(repo); }
})();

(function testGetBranchStalenessUndefinedDefaults() {
  const repo = makeRepo();
  try {
    sh('git checkout -b feature/ticket', repo);
    fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n');
    sh('git add b.txt', repo);
    sh('git commit -q -m "ticket"', repo);
    sh('git checkout main', repo);
    fs.writeFileSync(path.join(repo, 'c.txt'), 'c\n');
    sh('git add c.txt', repo);
    sh('git commit -q -m "main ahead"', repo);
    sh('git checkout feature/ticket', repo);

    const count = getBranchStaleness(repo);
    assert.strictEqual(count, 1,
      `getBranchStaleness() with no 2nd arg should fall back to config.branchDefault`);
    console.log('PASS: getBranchStaleness() with no 2nd arg defaults to config.branchDefault');
  } finally { cleanup(repo); }
})();

console.log('\n\u2705 All git-utils tests passed');
process.exit(0);
