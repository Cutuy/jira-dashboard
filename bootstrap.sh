#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# ── Colors ─────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}::${NC} $1"; }
ok()    { echo -e "${GREEN}✓${NC} $1"; }
warn()  { echo -e "${YELLOW}⚠${NC} $1"; }
err()   { echo -e "${RED}✗${NC} $1"; }

# ── Prerequisites ────────────────────────────────────────────
info "Checking prerequisites..."

command -v node >/dev/null 2>&1 || { err "Node.js is required"; exit 1; }
command -v npm  >/dev/null 2>&1 || { err "npm is required"; exit 1; }
command -v git  >/dev/null 2>&1 || { err "git is required"; exit 1; }

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 18 ]; then
  err "Node.js >= 18 required (found v$(node -v))"
  exit 1
fi
ok "Node.js $(node -v), npm $(npm -v)"

# ── .env ─────────────────────────────────────────────────────
info "Setting up .env..."

if [ -f .env ]; then
  ok ".env already exists — keeping your settings"
else
  cp .env.example .env
  ok ".env created from .env.example"
fi

# Helper: prompt for a value if the env var is missing or placeholder
ensure_env() {
  local key="$1" prompt="$2" default="$3"
  local current
  current=$(grep "^${key}=" .env | sed 's/^[^=]*=//' | head -1)
  # Check if missing, empty, or still the example placeholder
  if [ -z "$current" ] || [ "$current" = "/path/to/your/project" ] || [ "$current" = "my-project" ] || [ "$current" = "opencode" ]; then
    read -r -p "$prompt [$default]: " val
    val="${val:-$default}"
    if grep -q "^${key}=" .env; then
      sed -i "s|^${key}=.*|${key}=${val}|" .env
    else
      echo "${key}=${val}" >> .env
    fi
    ok "${key} set to ${val}"
  else
    ok "${key} already set"
  fi
}

ensure_env "JIRA_PROJECT_DIR" "Enter the absolute path to your git repo" "$HOME/project"
ensure_env "JIRA_CODER_BIN" "Path to your AI coder CLI (e.g. opencode)" "opencode"
ensure_env "JIRA_PROJECT_NAME" "Your project display name" "My Project"

# ── Install dependencies ─────────────────────────────────────
info "Installing server dependencies..."
npm install --no-audit --no-fund 2>&1 | tail -1
ok "Server dependencies installed"

info "Installing client dependencies..."
cd client
npm install --no-audit --no-fund 2>&1 | tail -1
cd "$ROOT"
ok "Client dependencies installed"

info "Building client..."
cd client
npm run build 2>&1 | tail -3
cd "$ROOT"
ok "Client built"

# ── Run mode ────────────────────────────────────────────────
echo ""
info "How should the dashboard run?"
echo "  1) Background — systemd user service (starts on boot, restarts on crash)"
echo "  2) Foreground — runs in this terminal (logs to stdout)"
read -r -p "Choose [1]: " mode
mode="${mode:-1}"

if [ "$mode" = "1" ]; then
  PORT=$(grep "^PORT=" .env | sed 's/^[^=]*=//' || echo "3006")
  UNIT_NAME="jira-dashboard-${PORT}"
  UNIT_PATH="$HOME/.config/systemd/user/${UNIT_NAME}.service"

  # Read project dir for EnvironmentFile (passes API keys to coder subprocess)
  PROJECT_DIR=$(grep "^JIRA_PROJECT_DIR=" .env | sed 's/^[^=]*=//' | head -1)

  if [ -f "$UNIT_PATH" ]; then
    ok "systemd service ${UNIT_NAME} already exists — keeping it"
  else
    info "Setting up systemd user service..."

    mkdir -p "$HOME/.config/systemd/user"

    cat > "$UNIT_PATH" <<-EOF
[Unit]
Description=Jira Dashboard (port ${PORT})
After=network.target

[Service]
Type=simple
WorkingDirectory=${ROOT}
ExecStart=$(command -v node) ${ROOT}/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=${PROJECT_DIR}/.env

[Install]
WantedBy=default.target
EOF

    ok "systemd unit created at ${UNIT_PATH}"
  fi

  systemctl --user daemon-reload 2>/dev/null || true
  systemctl --user enable "${UNIT_NAME}.service" 2>/dev/null || true
  systemctl --user restart "${UNIT_NAME}.service" 2>/dev/null || true

  echo ""
  ok "Dashboard running at http://localhost:${PORT}"
  info "Manage with: systemctl --user ${UNIT_NAME}.service {start|stop|restart|status}"
  info "Logs: journalctl --user -u ${UNIT_NAME}.service -f"
else
  echo ""
  info "Starting in foreground..."
  exec node server.js
fi
