# Hardcoded Configs — Completion Status

## ✅ All Addressed

| What | How |
|---|---|
| **VSCode/Cursor URIs** (`cutuy-claw` → `REMOTE_HOST`) | `config.js` + `.env` |
| **Explorer port** (`18802` → `EXPLORER_PORT`) | `config.js` + `.env` |
| **Page title** (`Pyxen Board` → `JIRA_PROJECT_NAME`) | `config.js` + `config.json` + `/api/config` endpoint |
| **db.js `dataDir`** hardcoded path | `db.js` imports `config.dataDir` |
| **Prepush timeout** `300_000` bypass | `server.js` uses `config.test.timeout` |
| **Resource monitor** `/proc/cpuinfo` parsing | `coder.js` uses `os.cpus().length` |
| **SQLite busy timeout** `5000` | `config.dbBusyTimeout` (env `DB_BUSY_TIMEOUT`) |
| **Default branch** `'main'` in 11 git commands | `config.branchDefault` (env `GIT_DEFAULT_BRANCH`) |
| **Run ID prefixes** (`test-`, `prepush-`, `sug-`, `_suggestions`) | Module-level constants in `server.js` |
| **Activity/files limits** (`24`, `12`) | Module-level constants in `App.tsx` |
| **Config.json** — machine-specific paths removed | Generic example, actual values in `.env` |
| **public-spa/assets/** — Vite build artifacts | Untracked + gitignored |
| **Tests** — config defaults, `.env` override, `config.json` override | 8 tests covering all config fields |
| **`.env.example`** — documents every env var | Placeholder values, no machine specifics |

## 🔲 Not Worth Extracting (low impact)

| What | Reason |
|---|---|
| UI strings (button labels, stage names) | i18n effort — not needed yet |
| Hex colors / Tailwind arbitrary colors | Theming system overkill |
| Poll intervals (`2000`, `10000`, `500`) | Minor, not user-facing |
| Pagination/truncation limits (SHA 7 chars, tail 60 lines, etc.) | Scattered, low value |
| `clkTck=100`, `PAGE_SIZE=4096` | Linux defaults, stable for x86/x64 |
