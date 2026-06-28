# Hardcoded Configs — Completion Status

## ✅ All Addressed

| What | How |
|---|---|
| **VSCode/Cursor URIs** (`cutuy-claw` → `REMOTE_HOST`) | `config.js` + `.env` |
| **Explorer port** → URL template (`EXPLORER_URL`) | `config.js` explorer.url template with `{sha}` `{path}` `{protocol}` `{host}` `{owner}` `{repo}` |
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

## 🔲 Sharing / Portability Gaps

| Priority | Gap | Impact |
|---|---|---|
| 🔴 | **No README / setup guide** | Nobody knows how to configure and run |
| 🔴 | **Test runner is Python-only** (`python -m project.test`) | Broken for JS/Go/Rust projects |
| 🔴 | **Client UI strings hardcode `"main"`** (App.tsx:918,1438) | Wrong if default branch is `master`/`develop` |
| 🔴 | **Linux-only resource monitor** (`/proc/pid/stat`, `PAGE_SIZE=4096`, `clkTck=100`) | Silently wrong on macOS/Windows |
| 🟡 | **VSCode/Cursor URI schemes only** | Other editors get dead links |
| 🟡 | **Python venv assumptions** (`VIRTUAL_ENV`, `PATH` prepend) | Irrelevant noise for non-Python projects |
| 🟡 | **opencode is the only real coder backend** | Other AI CLIs need a new `coder.js` backend |
| 🟡 | **`public-spa/` is untracked** | Fresh clone needs `cd client && npm run build` |
| 🟡 | **No first-run experience** | Empty DB, no config validation — silent failures |
| 🟡 | **No Docker / containerized setup** | Native module `better-sqlite3` needs C++ build tools |
| 🟢 | **`better-sqlite3` native module** | Must match Node.js version exactly |
| 🟢 | **`.githooks/pre-push` doesn't exist** | Pre-push API returns 400 |
| 🟢 | **Branch naming `feature/<slug>` hardcoded** | Can't customize prefix |
| 🟢 | **Suggestions empty if no project `docs/vision.md`** | No warning shown to user |
| 🟢 | **Default `projectDir` = `process.cwd()`** | Falls back to dashboard dir itself |
