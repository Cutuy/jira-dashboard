# UI Componentization Plan — Ticket Dialog

## Goal

Extract inline UI sections from `client/src/App.tsx` into dedicated
component files under `client/src/components/`. This shrinks a 2000+
line file into composable pieces, reduces duplication, and makes each
section independently testable.

## Already extracted

- [`PrBanner`](../client/src/components/pr-banner.tsx) — PR link banner with state colors, extracted from App.tsx

---

## Tier 1 — Repeating patterns (highest ROI)

These appear **identically across multiple ticket stages** — extracting
them eliminates duplication at the root.

### 1.1 `ConsoleOutput` / `StdoutConsole`

| App.tsx lines | Places used | Lines per instance |
|---------------|-------------|-------------------|
| ~1527, ~1591, ~1654, ~1846 | clarification, implementation, review, pr_opened | ~4 |

Renders a dark-background monospace scrollable box for coder stdout.

**Props:** `lines: string[]`

### 1.2 `LiveStatusSection`

| App.tsx lines | Stages |
|---------------|--------|
| ~1519 (clarification), ~1582 (implementation), ~1643 (review) | 3 |

Pattern: spinner + status text + `ResourceMetrics` + `ConsoleOutput`.
The status text and extra children (TODO list, files modified) vary by
stage, so the component accepts those as optional children.

**Props:** `status: string` | `statusText: string`, `activity`, `stageResources`, `children?`

### 1.3 `ImplementationPlanSection`

| App.tsx lines | Stages |
|---------------|--------|
| ~1565 (implementation), ~1770 (done/pr_opened) | 2 |

Renders a `Section` titled "Implementation Plan" with a dark `<pre>`
block and optional italic `plan_notes`.

**Props:** `plan: string | null`, `estimatedComplexity: string | null`, `planNotes: string | null`

### 1.4 `UnitTestsSection`

| App.tsx lines | Stages |
|---------------|--------|
| ~1716 (review), ~1786 (done/pr_opened) | 2 |

Renders a `Section` titled "Unit tests" wrapping `TestReportPanel`.

**Props:** `test: TestRun | null`, `onRerun: () => void`, `rerunning: boolean`, `autoExpandFail?: boolean`

### 1.5 `ResourceUsageSection`

| App.tsx lines | Stages |
|---------------|--------|
| ~1733 (review), ~1801 (done/pr_opened) | 2 |

Renders a `Section` titled "Resource usage" wrapping `ResourceMetrics`.

**Props:** `activity: A[]`, `stageResources: SR`, `status: string`

---

## Tier 2 — Large inline components with complex logic

These are 50+ lines each with significant state or IIFE-heavy logic.

### 2.1 `ResourceMetrics`

- **Lines:** 138 (App.tsx ~528–665)
- **Complexity:** per-stage bucket logic, live metrics from activity,
  progress bars, legacy totals
- **Status:** Inline function

### 2.2 `QuestionCard`

- **Lines:** 119 (App.tsx ~211–329)
- **Complexity:** multiple choice, freeform text, "other" text input,
  read-more toggle for long questions
- **Status:** Inline function

### 2.3 `TestReportPanel`

- **Lines:** 91 (App.tsx ~436–526)
- **Complexity:** running/pass/fail/skip/error state machine, collapsible
  test output, rerun button
- **Status:** Inline function

### 2.4 `DiffSection`

- **Lines:** 54 (App.tsx ~1661–1714)
- **Complexity:** file explorer URL construction from template, inline
  IIFE for link list
- **Props:** `diff`, `diffFiles`, `diffCommitSha`, `explorerConfig`

---

## Tier 3 — Self-contained stage-specific sections

Smaller but well-scoped boundaries. Good for incremental extraction.

### 3.1 `WorktreeSection`

- **Lines:** 44 (App.tsx ~1473–1516)
- **Renders:** metadata grid (path, branch), behind-count badge,
  VSCode/Cursor/View Diff action links
- **Props:** `worktreePath`, `branchName`, `behindCount`, `remoteHost`,
  `branchDefault`, `onViewDiff`

### 3.2 `ActivitySidebar`

- **Lines:** 43 (App.tsx ~334–376)
- **Renders:** scrollable activity log for the right column
- **Status:** Already an inline function `function ActivitySidebar`
- **Props:** `items: A[]`

### 3.3 `ClarificationQuestions`

- **Lines:** 26 (App.tsx ~1535–1560)
- **Renders:** round-grouped Q&A cards with `QuestionCard`
- **Props:** `questions`, `answers`, `onAnswer`, `disabled`, `error`

### 3.4 `ClarificationFooter`

- **Lines:** 28 (App.tsx ~1866–1893)
- **Renders:** Rebase / Retry / Submit Answers / Process Answers buttons
- **Props:** `sel`, `busy`, `rebaseLoading`, callbacks

### 3.5 `ReviewFooter`

- **Lines:** 20 (App.tsx ~1922–1941)
- **Renders:** Continue / Rebase / Send Feedback / Ready buttons
- **Props:** `sel`, `busy`, `rebaseLoading`, `feedback`, callbacks

### 3.6 `QaHistory`

- **Lines:** 20 (App.tsx ~1806–1825)
- **Renders:** read-only Q&A pairs for done/pr_opened
- **Props:** `questions: Q[]`

### 3.7 `MergedBanner`

- **Lines:** 9 (App.tsx ~1760–1768)
- **Renders:** green success box "Merged into main · Commit <sha>"
- **Props:** `commitSha: string | null`

### 3.8 `TodoProgressList`

- **Lines:** 17 (App.tsx ~1596–1612)
- **Renders:** checkbox list with styled done/undone states
- **Props:** `items: {done: boolean; text: string}[]`

### 3.9 `FilesModifiedList`

- **Lines:** 17 (App.tsx ~1613–1630)
- **Renders:** "Files modified · N" header + monospace file list, capped
  at `FILES_MODIFIED_MAX_VISIBLE`
- **Props:** `activity: A[]`

### 3.10 `FeedbackTextarea`

- **Lines:** 13 (App.tsx ~1743–1755)
- **Renders:** "Feedback (optional)" Section with textarea + error
- **Props:** `feedback`, `onChange`, `error`

---

## Legacy inline components (lowest priority)

These are already inline functions in App.tsx and are relatively
stable — extracted last:

- `Btn` (28 lines)
- `StagePill` (10 lines)
- `IconBtn` (10 lines)
- `TicketCard` (37 lines — used on board, not dialog)
- `Dialog`, `DialogHeader`, `DialogFooter`, `Section`, `StatusPill`
  (dialogs primitives at bottom of file)
- `SuggestionCard` (20 lines — used on board, not dialog)

---

## Extraction order (recommended)

1. `ConsoleOutput` — trivial, 4x savings, clears clutter immediately
2. `ResourceUsageSection` — small, 2x savings
3. `ImplementationPlanSection` — small, 2x savings
4. `UnitTestsSection` — small, 2x savings
5. `LiveStatusSection` — moderate, 3x savings
6. `MergedBanner` — tiny, 1 instance
7. `WorktreeSection` — moderate, 1 instance
8. `FeedbackTextarea` — tiny
9. `TodoProgressList` — small
10. `FilesModifiedList` — small
11. `ClarificationQuestions` — moderate
12. `QaHistory` — small
13. `PrTasksActions` — small
14. Footer sections (ClarificationFooter, ReviewFooter, PrOpenedFooter)
15. Large components (DiffSection, QuestionCard, TestReportPanel, ResourceMetrics)
