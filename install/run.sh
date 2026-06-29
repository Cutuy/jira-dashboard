#!/usr/bin/env bash
# Jira Dashboard — Bootstrap
#
# Usage: ./bootstrap.sh
#
# Interactive setup that configures, installs, and starts the dashboard.
# Idempotent — safe to run multiple times. Never touches your project data.

set -euo pipefail
export LC_ALL=C

INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$INSTALL_DIR")"
cd "$ROOT"

# ── Output helpers ─────────────────────────────────────────
BOLD='\033[1m'; RED='\033[0;31m'; GREEN='\033[0;32m'
YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

step()  { echo; echo -e "${CYAN}${BOLD}── ${1} ──${NC}"; }
info()  { echo -e "  ${CYAN}•${NC} $1"; }
ok()    { echo -e "  ${GREEN}✓${NC} $1"; }
warn()  { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail()  { echo -e "  ${RED}✗${NC} ${BOLD}$1${NC}"; exit 1; }
prompt(){ read -r -p "  ${BOLD}?${NC} $1 "; echo "$REPLY"; }

# ── Step 0: Prerequisites ──────────────────────────────────
step "Prerequisites"

command -v node >/dev/null 2>&1 || fail "Node.js is not installed. Install Node.js >= 18 first."
command -v npm  >/dev/null 2>&1 || fail "npm is not installed."
command -v git  >/dev/null 2>&1 || fail "git is not installed."

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
[ "$NODE_MAJOR" -ge 18 ] || fail "Node.js >= 18 required (found v$(node -v)). Upgrade Node.js first."

ok "Node.js $(node -v)  npm $(npm -v)  git $(git --version | awk '{print $3}')"

# ── Step 1: .env ────────────────────────────────────────────
step "Configuration"

if [ -f .env ]; then
  ok ".env already exists — keeping your settings"
else
  cp "$INSTALL_DIR/templates/env.template" .env
  ok "Created .env from template"
  warn "Edit .env to set JIRA_PROJECT_DIR and JIRA_CODER_BIN, then re-run bootstrap"
  warn "  or continue now and I'll prompt you for the essentials"
fi

resolve_env() {
  local key="$1" prompt_text="$2" default="$3" current
  current=$(grep "^${key}=" .env | sed 's/^[^=]*=//' | head -1)
  case "$current" in
    ""|/path/to/your/project|my-project|opencode)
      >&2 info "Setting ${key}..."
      val=$(prompt "$prompt_text [$default]")
      val="${val:-$default}"
      if grep -q "^${key}=" .env; then
        sed -i "s|^${key}=.*|${key}=${val}|" .env
      else
        echo "${key}=${val}" >> .env
      fi
      echo "$val"
      ;;
    *)
      >&2 ok "${key} already set"
      echo "$current"
      ;;
  esac
}

PROJECT_DIR=$(resolve_env "JIRA_PROJECT_DIR" "Absolute path to your git repo" "$HOME/project")
CODER_BIN=$(resolve_env "JIRA_CODER_BIN" "Path to your AI coder CLI" "opencode")
PROJECT_NAME=$(resolve_env "JIRA_PROJECT_NAME" "Your project display name" "My Project")

# Validate JIRA_PROJECT_DIR
[ -d "$PROJECT_DIR" ] || fail "Directory does not exist: ${PROJECT_DIR}"
[ -d "$PROJECT_DIR/.git" ] || warn "${PROJECT_DIR} is not a git repository — worktree features will fail"

# Validate JIRA_CODER_BIN (warn if not found, don't block — user may install later)
if [ "$CODER_BIN" != "opencode" ] && ! command -v "$CODER_BIN" >/dev/null 2>&1; then
  warn "Coder binary '${CODER_BIN}' not found on PATH. Install it or update JIRA_CODER_BIN in .env"
fi

# ── Step 2: Dependencies ────────────────────────────────────
step "Dependencies"

info "Installing server dependencies..."
npm install --no-audit --no-fund 2>&1 | tail -1
ok "Server dependencies installed"

info "Installing client dependencies..."
(cd client && npm install --no-audit --no-fund 2>&1 | tail -1)
ok "Client dependencies installed"

# ── Step 3: Build client ───────────────────────────────────
step "Client"

info "Building client..."
(cd client && npm run build 2>&1 | tail -3)
ok "Client built"

# ── Step 4: Run mode ────────────────────────────────────────
step "Run mode"

echo "  Choose how to run the dashboard:"
echo "    1) Background — systemd user service (starts on boot, survives terminal)"
echo "    2) Foreground — runs in this terminal (logs visible here)"
MODE=$(prompt "Enter 1 or 2 [1]")
MODE="${MODE:-1}"

case "$MODE" in
  1)  # Background — systemd
    PORT=$(grep "^PORT=" .env | sed 's/^[^=]*=//' || echo "3006")
    UNIT_NAME="jira-dashboard-${PORT}"
    UNIT_PATH="$HOME/.config/systemd/user/${UNIT_NAME}.service"
    SVC_TEMPLATE="$INSTALL_DIR/templates/template.service"

    if [ -f "$UNIT_PATH" ]; then
      ok "Systemd service ${UNIT_NAME} already exists — keeping it"
    else
      info "Creating systemd service..."

      mkdir -p "$HOME/.config/systemd/user"
      NODE=$(command -v node) \
      ROOT="$ROOT" \
      PORT="$PORT" \
      PROJECT_DIR="$PROJECT_DIR" \
      envsubst '${NODE} ${ROOT} ${PORT} ${PROJECT_DIR}' < "$SVC_TEMPLATE" > "$UNIT_PATH"

      ok "Created ${UNIT_PATH}"
    fi

    systemctl --user daemon-reload 2>/dev/null || warn "systemd daemon-reload failed (non-fatal)"
    systemctl --user enable "${UNIT_NAME}.service" 2>/dev/null || warn "systemd enable failed — run manually: systemctl --user enable ${UNIT_NAME}.service"
    systemctl --user restart "${UNIT_NAME}.service" 2>/dev/null || warn "systemd restart failed — check: journalctl --user -u ${UNIT_NAME}.service -e"

    echo ""
    ok "${BOLD}Dashboard running at http://localhost:${PORT}${NC}"
    echo ""
    info "Manage:  systemctl --user ${UNIT_NAME}.service {start|stop|restart|status}"
    info "Logs:    journalctl --user -u ${UNIT_NAME}.service -f"
    info "Config:  edit ${ROOT}/.env then restart the service"
    info "Data:    ${PROJECT_DIR}/.jira-dashboard/store.db"
    ;;

  2)  # Foreground
    echo ""
    info "Starting in foreground..."
    echo ""
    exec node server.js
    ;;

  *)
    fail "Invalid choice '${MODE}'. Run again and enter 1 or 2."
    ;;
esac
