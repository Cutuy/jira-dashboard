# Status

## ✅ Done

| What | How |
|---|---|
| Config fields generalized (remote host, ports, timeouts, branch, etc.) | `config.js` + `.env` env var overrides |
| Explorer port → URL template (`EXPLORER_URL`) | Template with `{sha}` `{path}` `{protocol}` `{host}` `{owner}` `{repo}` |
| `db.js` dataDir from config | Uses `config.dataDir` |
| Resource monitor uses `os.cpus().length` | No more `/proc/cpuinfo` parsing |
| SQLite busy timeout configurable | `DB_BUSY_TIMEOUT` |
| `'main'` → `config.branchDefault` | All 11 git commands use config |
| Merge strategy: cherry-pick or push+PR | `MERGE_STRATEGY=pr` pushes branch + `gh pr create` |
| Magic strings → named constants | `_suggestions`, `sug-`, `prepush-`, `test-`, activity/files limits |
| `config.json` is a generic example | Machine-specific values in `.env` |
| `public-spa/assets/` untracked | Vite build artifacts gitignored |
| Tests for config layer | Defaults, env override, config.json override, precedence |
| `.env.example` self-documenting | Inline comments for every var |
| `config.schema.json` | JSON Schema with descriptions + defaults |
| `$schema` ref in `config.json` | IDE intellisense for JSON editing |
| `docs/vision.md` filled | Project vision for suggestion generator |
| `docs/todo.md` | This file |
| README rewritten | New-user journey: clone → configure → start → use |

## 🔲 Still Open

| Priority | Gap | Impact |
|---|---|---|
| 🔴 | **Test runner is Python-only** (`python -m project.test`) | Broken for JS/Go/Rust projects |
| 🔴 | **Client UI hardcodes `"main"`** (App.tsx:918,1438) | Wrong if default branch is `master`/`develop` |
| 🔴 | **Linux-only resource monitor** (`/proc/pid/stat`, page size, clk_tck) | Silently wrong on macOS/Windows |
| 🟡 | **VSCode/Cursor URI schemes only** | Other editors get dead links |
| 🟡 | **Python venv assumptions** (`VIRTUAL_ENV`, `PATH` prepend) | Irrelevant noise for non-Python projects |
| 🟡 | **opencode is the only real coder backend** | Other AI CLIs need a new backend |
| 🟡 | **No first-run experience** | Empty DB, no config validation — silent failures |
| 🟡 | **No Docker / containerized setup** | Native module needs C++ build tools |
| 🟢 | **`better-sqlite3` native module version lock** | Must match Node.js exactly |
| 🟢 | **`.githooks/pre-push` doesn't exist** | Pre-push API returns 400 |
| 🟢 | **Branch naming `feature/<slug>` hardcoded** | Can't customize prefix |
| 🟢 | **Suggestions empty if no project `docs/vision.md`** | No warning shown |
| 🟢 | **Default `projectDir` = `process.cwd()`** | Falls back to dashboard dir itself |
