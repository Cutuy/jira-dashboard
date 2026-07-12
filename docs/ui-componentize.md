# UI Componentization Plan — Ticket Dialog

## Status

- [x] [`PrBanner`](../client/src/components/pr-banner.tsx) — extracted from App.tsx

---

## Tier 1 — Repeating patterns (highest ROI)

| # | Candidate | Lines | Appears in | Props | Status |
|---|-----------|-------|------------|-------|--------|
| 1 | [`ConsoleOutput`](../client/src/components/console-output.tsx) | ~4 x4 | clarification, implementation, review, pr_opened | `lines: string[]` | [x] |
| 2 | `LiveStatusSection` | ~40 x3 | clarification, implementation, review | `statusText`, `activity`, `stageResources`, `status`, `stdoutLines`, `children` | [ ] |
| 3 | [`ImplementationPlanSection`](../client/src/components/implementation-plan-section.tsx) | ~17 x2 | implementation, done/pr_opened | `plan`, `estimatedComplexity`, `planNotes` | [x] |
| 4 | `UnitTestsSection` | ~17 x2 | review, done/pr_opened | `test`, `onRerun`, `rerunning`, `autoExpandFail` | [ ] |
| 5 | [`ResourceUsageSection`](../client/src/components/resource-usage-section.tsx) | ~7 x2 | review, done/pr_opened | `activity`, `stageResources`, `status` | [x] |

---

## Tier 2 — Large inline components with complex logic

| # | Candidate | Lines | Complexity | Status |
|---|-----------|-------|------------|--------|
| 6 | `ResourceMetrics` | 138 | per-stage bucket logic, live metrics, progress bars | [ ] |
| 7 | `QuestionCard` | 119 | multiple choice, freeform, read-more toggle | [ ] |
| 8 | `TestReportPanel` | 91 | running/pass/fail/skip/error state machine, collapsible output | [ ] |
| 9 | `DiffSection` | 54 | file explorer URL templating, inline IIFE | [ ] |

---

## Tier 3 — Self-contained stage-specific sections

| # | Candidate | Lines | Renders | Props | Status |
|---|-----------|-------|---------|-------|--------|
| 10 | `WorktreeSection` | 44 | metadata grid + behind badge + VSCode/Cursor/View Diff links | `worktreePath`, `branchName`, `behindCount`, `remoteHost`, `branchDefault`, `onViewDiff` | [ ] |
| 11 | `ActivitySidebar` | 43 | scrollable activity log (right column) | `items: A[]` | [ ] |
| 12 | `ClarificationQuestions` | 26 | round-grouped Q&A cards | `questions`, `answers`, `onAnswer`, `disabled`, `error` | [ ] |
| 13 | `ClarificationFooter` | 28 | Rebase / Retry / Submit Answers / Process Answers | `sel`, `busy`, `rebaseLoading`, callbacks | [ ] |
| 14 | `ReviewFooter` | 20 | Continue / Rebase / Send Feedback / Ready | `sel`, `busy`, `rebaseLoading`, `feedback`, callbacks | [ ] |
| 15 | `QaHistory` | 20 | read-only Q&A pairs | `questions: Q[]` | [ ] |
| 16 | `MergedBanner` | 9 | green "Merged into main · Commit <sha>" | `commitSha: string \| null` | [ ] |
| 17 | `TodoProgressList` | 17 | checkbox list with done/undone states | `items: {done: boolean; text: string}[]` | [ ] |
| 18 | `FilesModifiedList` | 17 | "Files modified · N" header + file list (capped at 12) | `activity: A[]` | [ ] |
| 19 | `FeedbackTextarea` | 13 | "Feedback (optional)" Section with textarea + error | `feedback`, `onChange`, `error` | [ ] |
| 20 | `PrTasksActions` | 14 | PR tasks check list with name/action/result cards | `checks: {name: string; action: string; result: string}[]` | [ ] |
| 21 | `TestStatusIndicator` | 36 | status pills in header (pass/fail/error/skip/running) | `test: TestRun`, `onClick` | [ ] |
| 22 | `TicketMetaRow` | 64 | full header sub-section (ID, stage, status, timestamps, copy link) | `sel`, `copied`, `onCopyLink` | [ ] |

---

## Extraction order (recommended)

1. `ConsoleOutput` — trivial, 4x savings
2. `ResourceUsageSection` — small, 2x savings
3. `ImplementationPlanSection` — small, 2x savings
4. `UnitTestsSection` — small, 2x savings
5. `LiveStatusSection` — moderate, 3x savings
6. `MergedBanner` — tiny
7. `WorktreeSection` — moderate
8. `FeedbackTextarea` — tiny
9. `TodoProgressList` — small
10. `FilesModifiedList` — small
11. `ClarificationQuestions` — moderate
12. `QaHistory` — small
13. `PrTasksActions` — small
14. `TestStatusIndicator` — moderate
15. `TicketMetaRow` — large
16. Footer sections (`ClarificationFooter`, `ReviewFooter`)
17. Large components (`DiffSection`, `QuestionCard`, `TestReportPanel`, `ResourceMetrics`)
