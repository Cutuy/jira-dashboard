# Reliability and code quality audit

Scope: jira-dashboard backend, persistence, agent execution, Git/worktree lifecycle,
test execution, frontend state and CI. Initial review requested 2026-11-07.
Follow-up authorization: create a PR first, then use agents to fix the findings.
The audit below records the original evidence; remediation status is tracked
separately so the initial findings remain reviewable.

## Remediation

Branch: `fix/reliability-audit`, based on master
`a459976978984a3af038db03a32a8e394eea66e3`.
PR: [#33](https://github.com/Cutuy/jira-dashboard/pull/33), created with the
checklist before implementation agents were spawned. Three agents implemented
the persistence/worktree, ticket lifecycle/integration and coder/test execution
fixes; integration also repairs configuration validation and CI coverage.

| Finding | Remediation status | Regression evidence |
| --- | --- | --- |
| F01 | met: atomic database claims protect occupied slots through completed cleanup, including done/releasing tickets; failed cleanup retains its claim. | `tests/db.test.js`, real SQLite/Git `tests/worktree-manager.test.js`: concurrent acquisition, full pool, release race, cleanup failure and legacy duplicate ownership. |
| F02 | met: checked-out target branches fast-forward through Git's index/worktree machinery; unchecked-out refs use compare-and-swap. Compatible WIP survives; conflicting WIP blocks integration. | `tests/server-lifecycle.test.js`: clean integration survives next commit; staged/unstaged edits survive; overlapping edits reject and retry. |
| F03 | met: both allocation modes restore the exact saved feature head and reject missing remote state; pushes use an explicit expected-head lease. | Real bare remotes in `tests/worktree-manager.test.js` and `tests/server-lifecycle.test.js`, including unexpected remote changes. |
| F04 | met: acquisition persists base_sha; Ready accepts agent commits, derives legacy missing bases, and prepares a squash without first rewinding the working tree. Branch drift is rejected before staging or moving a ref. | `tests/server-lifecycle.test.js`: committed implement → Ready, legacy null-base/local-only repository, conflict retry and branch-drift preservation. |
| F05 | met: ticket operations own their full async lifetime; terminal actions cancel/await owners, tests and file monitoring before worktree release. Late completions cannot revive closed/deleted tickets. | Production handler tests: close during structured-output wait; duplicate implement during acquire; delete during execution; manual-test cancellation; deferred follow-up ownership. |
| F06 | met: INSERT/UPDATE include base_branch and base_sha. | `tests/db.test.js`: create/update/unrelated update/null reset round trips. |
| F07 | met: shared clarification failure persists clarify_error and restores idle when the run still owns a live ticket. | `tests/server-lifecycle.test.js`: automatic launch failure and cancellation paths. |
| F08 | met: nonzero coder exits reject with code, stderr, partial structured output and session metadata. | `tests/coder-process.test.js`: real executable exit 1 and normal structured completion. |
| F09 | met for timeout/graceful cancellation: shared execution terminates owned process groups and waits boundedly; one active test per ticket; close/Ready waits for tests; restart finalizes stale test rows. | `tests/process-runner.test.js`, `tests/test-runner.test.js`, `tests/server-lifecycle.test.js`: TERM-ignoring descendants, graceful exit-zero cancellation, manual close and project-level timeout. Abrupt-crash orphan identification remains limited as noted below. |
| F10 | met: legacy migration binds current ticket fields and all question/activity arguments while preserving legacy defaults and timestamps. | `tests/db.test.js`: representative legacy and newer JSON records, Q&A/options, activity/stage, exact archived input. |
| F11 | met: relative source paths and absolute paths inside the main checkout resolve to their tested-worktree equivalents; external absolute source paths stay external. | `tests/test-runner.test.js`: real Python import identity for direct and detected commands, including paths containing spaces/apostrophes. |

Additional quality fixes: config.schema.json parses and is applied during config
load; partial timeout overrides retain other stage limits; invalid numeric
settings and check patterns fail before execution; explicit false test settings
override JSON defaults. `npm test` discovers every backend test file, and CI runs
client tests, lint and build in a separate job.

Local integration: Node 24.18.0 with the current branch's locked dependencies;
all 15 backend test files passed (`/tmp/jd-remediation-full-tests.log`), 17 client
tests passed, client lint exited 0 with the 14 existing warnings, client build
passed, and `git diff --check` passed. The final lifecycle suite covers 14 real
handler scenarios, including branch drift and file-monitor settlement. The PR's
final commit receives both CI jobs.

Limits and follow-ups: native macOS/Windows and live coding-service behavior
remain unverified. Restart recovery finalizes stale test rows but has no persisted
test process identity to locate a process group left by an abrupt manual/server
crash. Graceful cancellation and timeouts are covered. The frontend App/component
cycle (O01), shared adapter usage counters/remaining synchronous Git paths (parts
of O02), and PR review pagination/completeness (O05) are follow-up observations;
this PR does not claim those broader refactors are complete. Coder stdout capture
is bounded at 4 MiB and reports overflow as an explicit incomplete-result error;
test output stays within the existing 64 KiB persisted-output contract.

Source revision: `222f790cc153c205023f10fbe5358c43999acd50`. The three subsequent
dependency PRs (#30–32) change only package lockfiles; source behavior is reviewed
at this revision. Working tree was clean at audit start.
GitHub comparison confirmed that current master
`a459976978984a3af038db03a32a8e394eea66e3` differs only in `package-lock.json` and
`client/package-lock.json`. Local tests used the original locked dependencies;
the findings concern source code shared by both revisions.

Baseline: [sane-engineer requirements](https://github.com/Cutuy/doramcap/blob/main/.agents/skills/sane-engineer/requirements.md),
blob `33b908febeb89eff2d6b196c8f4208bc0fdc509a`; workflow:
[SKILL.md](https://github.com/Cutuy/doramcap/blob/main/.agents/skills/sane-engineer/SKILL.md),
blob `220751ecd6bff8e48c9057eafd4e1647b31391e2`.
No governing `requirements.md` or applicable `AGENTS.md` was found in this checkout
or its accessible ancestors. Product requirements may be unspecified. README,
CONTRIBUTING and docs are supporting behavioral evidence, not newly adopted
requirements. No requirements file is created or modified.

## Initial audit traceability

Each SE ID refers to the identically numbered item in the baseline above.
Unverified means the available evidence cannot establish compliance; it does not
establish a violation. Inactive change/workflow obligations are marked unverified
with their scope explained. Preferences retain their stated strength.

| ID / source | Concrete requirement / acceptance | Status | Evidence / gap |
| --- | --- | --- | --- |
| SE-001 | Public operations and state belong to their semantic owner; trace callers. | unmet | F01: the allocator consumes a UI list projection as an ownership inventory. Named db/manager/pool/adapter modules provide useful separation, but the actual query contract defeats isolation. |
| SE-002 | Separate invocation/observation from lifecycle policy and workflow. | unmet | F05/F07/F09: server handlers, coder-runner and test-runner independently manage incomplete parts of cancellation and terminal state. Generic execution is factored out, but lifecycle ownership is incomplete. |
| SE-003 | Keep backend mechanics and backend-specific state scoped to adapters. | met | CLI arguments, environment construction and backend event parsing live in coder/opencode.js, claude.js and codex.js. The registry selects known backends. Shared session/usage lifetime defects are assessed under SE-007 and O02. |
| SE-004 | Core contracts remain independent of incidental input/UI format. | unmet | F01: an abbreviated board list is reused as the authoritative worktree allocation contract. F06: API input exists but is omitted by persistence. |
| SE-005 | Shared contracts have demonstrated semantics; avoid speculative abstractions. | met | Four concrete adapters implement invocation, environment and parsing; pool primitives operate on explicit paths/refs. No speculative plugin framework observed. Does not establish lifecycle correctness. |
| SE-006 | Dependencies follow established ownership decisions. | unverified | No explicit module dependency policy or crate boundaries documented for this application. O01 identifies a concrete frontend dependency cycle; it is a quality suggestion, not an invented layering requirement. |
| SE-007 | Distinguish configuration, resolved launch state, live resources and results. | unmet | F05/F08/F09: terminal ticket state, live child processes, partial output and completion are conflated. Per-ticket process map exists, but tests are outside it and close does not await termination. |
| SE-008 | Document workload limits, scope and exhaustion behavior. | unmet | Worktree count and timeouts are documented (`config.js:125`, `config.schema.json:101`), but advertised POOL_FULL behavior is defeated by F01 and test timeout by F09. No arbitrary memory/workload ceiling inferred. |
| SE-009 | Validate configuration and prepared input before dependent side effects when possible. | unmet | O03: schema is invalid JSON and never applied by config loader; timeout object replaces defaults wholesale; invalid check regexes are compiled later during work. Full acceptance policy remains unspecified. |
| SE-010 | Exhaustion/platform failures are explicit or documented partial outcomes. | unmet | F01 fails pool admission; F08 discards nonzero exit information; F09 does not enforce timeout on child trees. Native macOS/Windows execution remains unverified. |
| SE-011 | Preserve complete underlying observations; failed/truncated reads are not empty success. | unmet | `pr-checker.js:54–75` turns review-thread retrieval failure into an empty list; query at :59 reads first 100 threads/comments without pageInfo or pagination. `git-utils.js:64` swallows status errors. Historical activity is limited to 500 rows, with no history API; completeness beyond that is unverified. |
| SE-012 | Assess actual retained memory/resources and backpressure under supported workload. | unmet | Test/coder runners accumulate full stdout/stderr before trimming; SSE writes ignore backpressure (`sse.js:8`); closed PR watchers retain intervals (`pr-checker.js:197`). F09 reproduces retained live descendants after timeout. Workload thresholds are unspecified; no numeric capacity failure claimed. |
| SE-013 | Relevant tests exercise acceptance, exhaustion and traversal completeness. | unmet | F01 is hidden by a mock returning full ticket rows (`tests/worktree-manager.test.js:49`). No production-handler + real-database workflow suite; no thread pagination or process-tree timeout tests. See O04. |
| SE-014 | Preserve persisted/wire behavior and actual callers unless change requested. | unmet | F06 silently drops base_branch writes; F10 breaks legacy JSON migration. F03 drops existing PR branch state during reacquisition. |
| SE-015 | Ownership changes update callers, docs and tests together. | unverified | Review makes no ownership changes; historical change completeness not inferred from current code. Existing contract/test discrepancies are recorded directly in F01/O04. |
| SE-016 | API contracts explain relevant errors, concurrency and cancellation. | unmet | Comments document close as terminal and pool admission as exclusive, but F01/F05 violate those observable promises. `getAllTickets` has no return-shape contract and means a list projection rather than complete rows. |
| SE-017 | Favor simple, explicit behavior; no speculative refactor required. | met | Small explicit adapter/pool modules are a useful basis. Proposed improvements are bounded: explicit query shapes, one run lifecycle, safe Git integration and contract tests. No framework or language rewrite required. |
| SE-018 | Prefer Rust/TypeScript for new implementation; Python only for tooling/tests. | unverified | Existing stack is JS/TS with shell installer; no application implementation added. No historical approval failure inferred and no rewrite proposed solely to satisfy a preference. |
| SE-019 | Favor typed protobuf configuration where practical; preserve third-party formats. | unverified | Existing handwritten JS config/JSON schema has no protobuf model. Preference alone does not mandate migration. O03 addresses actual validation defects within the current format. |
| SE-020 | Favor typed dynamic configuration; new environment inputs require approval. | met | This audit introduces no environment inputs or contract changes. Existing `config.js` centralizes dashboard env loading; historical approval evidence unavailable. |
| SE-021 | Evaluate dependencies within authorization before adoption. | unverified | No dependency adoption in this review. Temporary fixtures install the repository's lockfiles; no dependency evaluation or historical approval claim is made. |
| SE-022 | Tests assert observable behavior with real integration inputs when applicable. | unmet | O04: manager tests mock a different DB contract; workflow tests duplicate Git sequences instead of calling handlers, and assert byte preservation without a subsequent commit. Existing UI component tests pass but do not cover ticket workflows. |
| SE-023 | Record focused checks and required CI coverage; no unsupported full-pass claim. | met | Existing npm test (8 backend files), two omitted backend files, frontend 17 tests, lint and build executed under Node 24.18.0. Reproductions exercised 11 defects. Cloud CI was inspected, not rerun; no PR publication. O04 records omissions. |
| SE-024 | Respect platform/capability evidence and credential scope; distinguish environments. | met | Linux arm64 validation only; no system service installation, privileged build, live AI call or external PR mutation. Child-process fixture checks ran outside the sandbox after EPERM; native macOS/Windows and actual CLI integrations explicitly unverified. |
| SE-025 | Preserve source changes and follow applicable worktree/integration process. | met | No repository-specific lease process found. Only this untracked checklist edited; implementation untouched. Destructive Git reproductions use disposable repositories under /tmp; no staging, commits or integration in the user repository. |
| SE-026 | Documentation stays concise and explains behavior; plans record validation. | unmet | README is concise with architecture and setup links. Behavioral drift remains: F02 contradicts the implication that accepted work is safely applied; `freshDefaultBase` callers claim a fetch while implementation/tests intentionally do not fetch; no plan edits made. |
| SE-027 | PRs lead with problem/behavior and concise validation. | unverified | No PR created/updated by this review; historical PR-writing compliance outside scope. |

## Initial audit findings

Five P1 findings and six P2 findings, all supported by focused reproductions.
P1 means a normal supported workflow can lose work or block task completion.
P2 means a conditional failure, wrong result or recovery/compatibility defect.

### F01 — P1: Pool allocation resets another ticket's worktree

Trigger: enable the pool, let ticket A acquire a slot, then implement ticket B.
`worktree-manager.js:82–96` expects `db.getAllTickets()` to include worktree_path.
The exported function uses the abbreviated SELECT at `db.js:116`, not the full-row
statement at :117. The claimed set is always empty. `worktree-pool.js:149–157`
hard-resets and cleans the first slot again, even while A owns it.

Reproduction with real SQLite and Git: A and B both received pool-0 and A's
uncommitted `only-a.txt` was deleted. This needs no simultaneous requests.
The mock at `tests/worktree-manager.test.js:49` returns complete rows and hides it.
Use an explicit ownership query/reservation with a database invariant; test the
real query plus allocator, including a second ticket and a full pool.

### F02 — P1: Default-branch integration leaves the checked-out index stale

Trigger: Ready reaches the non-PR integration step while the main checkout is on
the default branch. `server.js:1238` moves its ref with update-ref but leaves the
index and working tree at the previous commit. A previously clean checkout then
contains staged reversions of the accepted feature.

Reproduction of this exact Git operation: accepting a new tracked feature file
produced `D  feature.txt` in the main checkout; committing a separate `user.txt`
removed the accepted feature from HEAD. No pre-existing user edits were needed.
The byte-preservation test at `tests/git-workflow.test.js:120` does not check a
subsequent commit. Integration must account for a checked-out target's index and
worktree, preserve user edits explicitly, and verify the expected old ref.

### F03 — P1: PR rework loses the original implementation before force-pushing

Trigger: per-ticket mode (`NUM_WORKTREES=0`), PR opened, then feedback/rework.
`pushAndOpenPr` releases the worktree (`server.js:172–173`), and release deletes
its branch. Reacquisition in `worktree-manager.js:163–188` creates the branch from
the default base; restoring the saved remote feature branch exists only in the
pooled path (:147–154). The next push uses `--force` (`server.js:126`).

Reproduction: created an original feature commit and remote-tracking feature ref,
released the ticket, and reacquired it. HEAD was the default base and the original
implementation file was absent. No remote push was performed; replacement of the
PR's head on the next successful force push follows statically from the code.
Restore the existing feature head in both modes, fail visibly if restoration
fails, and protect remote updates against unexpected head changes.

### F04 — P1: Normal successful implementation cannot complete Ready

Trigger: default per-ticket mode + cherry-pick strategy + agent commits its work
as instructed by `prompts.js`. Per-ticket acquisition never records base_sha
(`worktree-manager.js:163–192`). Ready sees commits ahead, skips squash without
base_sha, then unconditionally calls commit on a clean tree
(`server.js:1194–1210`). Git exits with nothing to commit.

Reproduction called the production manager, implementation finalizer and Ready
handler with real Git/SQLite: HTTP 500, base_sha null, ticket remains review.
Record the branch point in both modes and correctly accept already committed
work. Validate the complete implement → review → Ready contract.

### F05 — P1: Close is not terminal for late asynchronous completion

Trigger: close a ticket while clarification is waiting for its structured output.
`runClarify` drops status to idle at `server.js:425` before up to 29 seconds of
file retries. Close sets done (:1297), but the resumed handler writes
implementation without rechecking terminal state (:478–486).

Reproduction: let the coder finish, close during the real output-file wait, then
deliver valid output. Stage changed done → implementation. No live process or
assumption about signal handling was required. Other handlers also lack uniform
post-await guards; close sends signals without awaiting exit before release
(`coder-runner.js:7–20`). Give runs an identity/cancellation owner, reject late
state writes, and settle owned work before reclaiming its worktree.

### F06 — P2: The requested base branch is silently discarded

The create API accepts base_branch (`server.js:349–356`), and later worktree/PR
operations consume it, but neither ticket INSERT nor UPDATE includes that column
(`db.js:119–139`). The column/default alone does not persist the input.

Real SQLite reproduction: both createTicket({base_branch:'release'}) and
updateTicket(...,{base_branch:'release'}) returned base_branch null. Tasks can
start from or integrate into the configured default instead of the requested
branch. Include the field in the persistence contract and round-trip test it.

### F07 — P2: Automatic clarification failures leave tickets permanently busy

Trigger: the automatic coder call rejects, such as a CLI launch/auth failure.
`runClarify` sets running (:396), but the auto-create catch
(`server.js:359–361`) logs to console only. The explicit clarify endpoint has
different cleanup (:519–522). Suggestions/PR auto-triggers have similar wrappers.

Production-handler reproduction with an injected launch error: POST returned 201,
the ticket stayed running, and its persisted activity lacked a clarify_error.
Normal retry/answer endpoints reject running tickets until recovery/restart.
Move failure persistence and status cleanup into the shared operation, guarded
against a newer run or terminal state.

### F08 — P2: A failed coder process resolves as successful

`coder/index.js:140–141` resolves any nonzero numeric exit if parsed text exists,
discarding the exit code and stderr. Adapters also return raw stdout when parsing
fails, so a progress line is enough. Callers then finalize normal implementation
rather than the partial/error path.

Real executable reproduction: printed partial progress, printed credentials
expired to stderr, and exited 1. coder.run resolved `{text: ...}` with no failure
metadata. Preserve the exit/error result and partial output separately; only
documented backend-specific partial-success cases should enter success paths.

### F09 — P2: Test timeouts and close do not own the test process tree

`test-runner.js:77–91` applies the timeout to bash and waits for close without
terminating descendants. Tests are not registered in runningProcs. A close/Ready
can release or reuse the worktree while tests keep executing; a descendant that
inherits output pipes can also prevent close and keep the promise pending.

Real-command reproduction: a 150 ms timeout returned after roughly 1,045 ms and
a child wrote a file after the timeout. The one-second child exited normally;
no persistent process was left behind. Track test runs with cancellation and
process-group termination, wait for completion before reuse, and recover stale
running test rows after restart. This is not a requirement to forbid user
acceptance on failed tests; that product policy is unspecified.

### F10 — P2: Legacy JSON migration prevents startup

Trigger: an empty/new SQLite database alongside a nonempty legacy store.json.
`db.js:521–544` calls the current INSERT without its required pr_url and
pr_touched_checks bindings. Question/activity calls below also use outdated
argument counts (:548, :554).

Real migration reproduction failed immediately with `Missing named parameter
"pr_url"`, propagated by module initialization. The JSON file remained intact;
no data-deletion claim is made. Keep migration adapters compatible with their
source format and test a representative legacy store including Q&A/activity.

### F11 — P2: Python tests can validate the main checkout instead of ticket code

`test-runner.js:79` sets PYTHONPATH to config.projectDir/src despite running in
the worktree; the named-project command at :41 does likewise. Src-layout Python
imports therefore resolve to the original checkout, so changed ticket code may
not be exercised.

Real Python reproduction: different audit_module.py values in main/src and
worktree/src; the test command ran with cwd=worktree and printed `main checkout`.
Derive source paths from the tested worktree and verify source identity as part
of an integration test.

## Initial audit validation

Environment: Linux arm64, temporary Node v24.18.0, satisfying the repository's
>=24.18.0 <25 contract. Dependencies and source copied to
`/tmp/jd-reliability-audit`; package installation did not change this checkout.
Initial sandbox run blocked a Git fixture with EPERM; it was rerun successfully
with child-process access. That initial failure is an environment result.

| Check | Result / scope |
| --- | --- |
| Backend npm test | Passed all 8 configured backend test files. Log: `/tmp/jd-backend-tests.log`. |
| Existing git-utils test | Passed; omitted from npm test. Log: `/tmp/jd-extra-git-tests.log`. |
| Existing run-clarify-wrapper test | Exited 0; its own explicit process.exit does not await the last async test. Log: `/tmp/jd-extra-clarify-tests.log`. |
| Frontend npm test | 5 files / 17 tests passed. Log: `/tmp/jd-client-tests.log`. |
| Frontend npm run lint | Exit 0, 14 warnings (unused symbols, hook dependencies, fast refresh). Log: `/tmp/jd-client-lint.log`. |
| Frontend npm run build | Passed. Vite build is not a TypeScript type check. Log: `/tmp/jd-client-build.log`. |
| F01–F07 lifecycle fixtures | Assertions reproduced all seven. Actual db.js, worktree manager/pool and server handlers; Express listener disabled; coder completion/failure controlled. No real agent or GitHub writes. |
| F08–F11 process/migration fixtures | Assertions reproduced all four using a real fake CLI executable, timed child, Python import, and legacy JSON/SQLite initialization. |
| GitHub source comparison | Master differs from reviewed source only in the two dependency lockfiles. No source changes missed after #30–32. |
| Cloud CI | Inspected workflow; not dispatched by audit. Recent dependency PR CI was green but runs only backend npm test. |
| Native macOS/Windows, browser workflows, actual AI CLIs, live PR rework | Not executed. Service adapters inspected statically; no claims of platform qualification or end-to-end pass. |

Reproduction scripts: `/tmp/jd-audit-repro.cjs` and
`/tmp/jd-audit-process-repro.cjs`. Results: `/tmp/jd-repro-results.log` and
`/tmp/jd-process-results.log`. Fixtures are disposable; the evidence summaries
above remain in this persistent checklist.

## Initial audit observations and unresolved scope

O01 — Frontend ownership: App.tsx is 1,980 lines and imports extracted sections,
while those sections import Section/ResourceMetrics/TestReportPanel back from App.
This creates an actual module cycle (`components/unit-tests-section.tsx:1`,
`resource-usage-section.tsx:1`, `live-status-section.tsx:2`). Keep view primitives
and shared contracts in lower-level modules, then let App compose them. Build
passes today; no current runtime failure is attributed to the cycle.

O02 — Execution ownership: server.js mixes ticket transitions, Git integration,
recovery, PR publishing and process observation. coder/store.js is process-global,
Claude's delta counters are adapter-global, and captureSessionId falls back to
the last global session (`coder-runner.js:80–89`). Concurrent tickets do not have
isolated session/usage observation state. Scope these values to a run and pass
explicit results; actual concurrent third-party CLI behavior remains unverified.
Synchronous Git commands in handlers can block all HTTP/SSE clients for their
command timeout; avoid broad synchronous operations on request paths.

O03 — Configuration quality: config.schema.json has a trailing comma at :124 and
fails strict JSON parsing at line 125. config.js reads config.json directly and
does not validate against that schema. A partial coder.timeouts object replaces
all timeout defaults at :139; invalid PR check regexes are compiled during async
checks rather than loading. Validate the existing format and merge defaults
before preparing work. A protobuf/config-language migration is optional and is
not needed to address these defects.

O04 — Test strategy: passing tests substantially overstate workflow confidence.
The mocked DB shape hides F01. Some tests duplicate implementation snippets
(`tests/git-workflow.test.js`, `tests/run-clarify-wrapper.test.js`) and never invoke
the production handler. CI runs only root npm test and omits frontend checks plus
two existing backend files. No type-check script or tsconfig is present in client;
Vite transpilation does not establish type correctness. Prefer a small set of real
database + Git workflow tests covering allocation, cancellation, PR restoration,
integration and recovery, then wire existing client checks into CI. No tests or
CI changes are made by this review.

O05 — Complete observations: pr-checker reads first 100 review threads and first
100 comments without pageInfo, and logs a fetch failure then continues as though
there are no unresolved review comments. Show-bucket feedback is cleared only
when pr_rework_needed is true (`pr-checker.js:119–125`), which can leave resolved
tasks stale. A supported PR-size ceiling is unspecified. Expose incomplete/error
state and paginate before claiming all comments handled; do not infer that a
failed read proves resolution.

At completion of the initial review, no product requirements, implementation,
dependencies, configuration contracts, services or published artifacts were
changed. Only this checklist was added locally. Subsequent authorized changes
are tracked in Remediation above.
