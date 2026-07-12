# SRE Runbook — Jira Dashboard

## Common Incidents & Recovery Procedures

### 1. Service Crash — `TypeError: Cannot read properties of undefined (reading 'catch')`

**Symptoms:** Server exits with status 1, systemd restarts. Stack trace points to
`pr-checker.js:186`.

**Root cause:** The `_runClarify` wrapper in `server.js` didn't `return` the
Promise from the async `runClarify` function, so `.catch()` was called on
`undefined`.

**Check:**
```sh
journalctl --user -u jira-dashboard-3006 --no-pager -n 50 | grep "TypeError"
```

**Fix:** Already patched in commit `6f079f9` → `5b07f08`. The wrapper now returns
the Promise, and `Promise.resolve()` is used as a belt-and-suspenders guard at
the call site.

---

### 2. Worktree Pool — All Slots Fail Acquire

**Symptoms:** Activity log shows `worktree_acquire_warn` for all pool slots. The
ticket stays in `implementation` stage with `status: idle` and `worktree_path:
null`.

**Common error messages:**
- `index file smaller than expected` — Index file corrupted from a crash or
  concurrent git process
- `unable to create file <path>: File exists` — Stale files from a prior
  worktree user left behind
- `unable to unlink old <file>` — File permissions or stale `.bazelrc`-like
  files at the worktree root

**Recovery:**

```sh
# For each corrupted pool slot (0, 1, 2, ...)
wt=/home/jcui/nuro-ai/.worktrees/pool-0
git -C "$wt" checkout --detach          # resets HEAD, rebuilds index
git -C "$wt" reset --hard               # force-clean working tree
git -C "$wt" clean -fd                  # remove untracked files
```

After cleaning, verify:
```sh
git -C "$wt" rev-parse --abbrev-ref HEAD  # should be "HEAD"
git -C "$wt" status --porcelain           # should be empty
```

Then retry the ticket action in the UI.

**Prevention:** `clearIndexLock()` in `worktree-pool.js` only removes
`.git/index.lock`. A corrupted index or stale working-tree files are not
handled. Consider adding a more robust cleanup to `acquireSlot()`.

---

### 3. Ticket Stuck at Stage Without Progress

**Symptoms:** A ticket stays in `clarification` or `implementation` stage with
`status: idle` for an extended period.

**Check ticket state:**
```sh
sqlite3 /home/jcui/nuro-ai/.jira-dashboard/store.db \
  "SELECT id, stage, status, base_branch, worktree_path, pr_url \
   FROM tickets WHERE id = '<ticket-id>';"
```

**Check activity log:**
```sh
sqlite3 /home/jcui/nuro-ai/.jira-dashboard/store.db \
  "SELECT datetime(time, 'localtime'), action, substr(detail,1,200) \
   FROM activity WHERE ticket_id = '<ticket-id>' ORDER BY id DESC LIMIT 20;"
```

**Common fixes:**
- Worktree pool full → wait for another ticket to release, or increase
  `numWorktrees` in config
- `base_branch` missing → `UPDATE tickets SET base_branch = '<branch>' WHERE id
  = '<ticket-id>';`
- Corrupt worktree → clean the slot (see section 2) and retry

---

### 4. Ticket Has Wrong or Missing `base_branch`

**Symptoms:** PR targets the repo default branch instead of the intended base.
Diff and staleness checks are relative to the wrong branch.

**Check:**
```sh
sqlite3 /home/jcui/nuro-ai/.jira-dashboard/store.db \
  "SELECT id, base_branch FROM tickets WHERE id = '<ticket-id>';"
```

**Fix — set `base_branch` on an existing ticket:**
```sh
sqlite3 /home/jcui/nuro-ai/.jira-dashboard/store.db \
  "UPDATE tickets SET base_branch = '<branch-name>', updated_at = datetime('now') \
   WHERE id = '<ticket-id>';"
```

If the ticket has already advanced past clarification, move it back:
```sh
sqlite3 /home/jcui/nuro-ai/.jira-dashboard/store.db \
  "UPDATE tickets SET stage = 'clarification', status = 'idle', \
   plan = NULL, review_feedback = NULL, worktree_path = NULL, \
   branch_name = NULL, commit_sha = NULL, updated_at = datetime('now') \
   WHERE id = '<ticket-id>';"
```

**Note:** Tickets created before the `base_branch` column migration
(commit `7284fa2`) will have `base_branch = NULL` even if the Bugbot payload
included a base branch. Manually set it as above.

---

### 5. Service Won't Start / Port Conflict

**Check:**
```sh
systemctl --user status jira-dashboard-3006
journalctl --user -u jira-dashboard-3006 --no-pager -n 30
```

**Common causes:**
- Port 3006 already in use → `lsof -i :3006`
- `.env` file missing → copy `.env.example` to project root
- `gh` auth expired → `gh auth refresh -h <host>`
- `crypto.randomBytes is not a function` → Node.js version mismatch (need v22+)

---

### 6. Frontend Shows Stale Data

**Force refresh:** The SPA polls the API every 2s via SSE. If the UI appears
stale, do a hard refresh (`Ctrl+Shift+R`) to clear the React state.

**Rebuild frontend:**
```sh
cd /home/jcui/jira-dashboard/client && npm run build
```

Output goes to `../public-spa/`. No server restart needed — Express serves the
new files on the next request.

---

### 7. Useful SQL Queries

```sh
# All tickets with their stage and base branch
sqlite3 /home/jcui/nuro-ai/.jira-dashboard/store.db \
  "SELECT id, stage, status, base_branch FROM tickets ORDER BY updated_at DESC;"

# Count tickets per stage
sqlite3 /home/jcui/nuro-ai/.jira-dashboard/store.db \
  "SELECT stage, count(*) FROM tickets GROUP BY stage;"

# Recent activity across all tickets (last 50 entries)
sqlite3 /home/jcui/nuro-ai/.jira-dashboard/store.db \
  "SELECT datetime(time,'localtime'), ticket_id, action, substr(detail,1,80) \
   FROM activity ORDER BY id DESC LIMIT 50;"

# Tickets with base_branch set (stacked PRs)
sqlite3 /home/jcui/nuro-ai/.jira-dashboard/store.db \
  "SELECT id, base_branch FROM tickets WHERE base_branch IS NOT NULL;"
```
