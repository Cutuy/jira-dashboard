# Hardcoded Configs to Generalize

## ✅ Done

### 🔴 High Priority — All Completed

| What | How |
|---|---|
| Username in VSCode/Cursor URIs (`cutuy-claw`) | `config.js`: `remoteHost` field (env `REMOTE_HOST`) |
| Explorer port `18802` | `config.js`: `explorerPort` field (env `EXPLORER_PORT`) |
| `db.js` ignores `config.dataDir` | `db.js` now imports `config` and uses `config.dataDir` |
| Prepush timeout `300_000` bypasses config | `server.js`: uses `config.test.timeout` |
| `'Pyxen Board'` title | Client fetches `/api/config` and uses `cfg.projectName` |

### 🟡 Medium Priority — All Completed

| What | How |
|---|---|
| Resource monitor: `ncores` parsing `/proc/cpuinfo` | `coder.js`: uses `os.cpus().length`, `PAGE_SIZE` constant |
| Busy timeout `5000` | `config.js`: `dbBusyTimeout` field (env `DB_BUSY_TIMEOUT`), used in `db.js` |
| Default branch `'main'` in git commands | `config.js`: `branchDefault` field (env `GIT_DEFAULT_BRANCH`), all 11 occurrences replaced |
| Random byte counts (3, 4, 6) | Still module-local — minor |

### 🟢 Lower Priority — Partially Done

| What | How |
|---|---|
| Magic strings `'_suggestions'`, `'sug-'`, `'prepush-'`, `'test-'` | Extracted as module-level constants in `server.js` |
| `ACTIVITY_MAX_VISIBLE=24`, `FILES_MODIFIED_MAX_VISIBLE=12` | Extracted as module-level constants in `App.tsx` |
| `SUGGESTIONS_MAX=5`, `TEST_OUTPUT_MAX_BYTES=64KB` | Already module-level constants — acceptable |
| `'__other__'` marker | Already extracted as `OTHER_MARKER` in `App.tsx` |

## 🔲 Still Open

### 🟢 Lower Priority (minor / not extracted)

| What | Notes |
|---|---|
| UI strings (button labels, placeholders, stage names) | i18n — bigger effort |
| Hex colors / Tailwind arbitrary colors | Theming system — bigger effort |
| Poll intervals (`2000`, `10000`, `500`) | Minor — not extracted |
| Pagination/truncation limits (SHA 7 chars, test output tail 60 lines, etc.) | Scattered across both files — low impact |

## 🟣 Additional Notes

- **API base route** `/api/tickets` used widely in `client/src/App.tsx` — consider an `API_BASE` constant.
- **Stage pipeline** (`clarification` → `implementation` → `review` → `done`) — centralize as an enum in shared constants.
- **`data` dir** (`store.db`, `store.json`, `context.md`) — all derive from `config.dataDir` now.
- **Resource monitoring in `coder.js`** — `clkTck=100` and `PAGE_SIZE=4096` remain hardcoded (Linux defaults, low impact).
