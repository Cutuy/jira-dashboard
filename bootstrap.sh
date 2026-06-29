#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "╔════════════════════════════════════════════════════╗"
echo "║  Jira Dashboard — Setup                          ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""

exec "${ROOT}/install/run.sh"
