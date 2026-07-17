#!/usr/bin/env bash
set -euo pipefail

# Kit Demo — Interactive Trial
# Run: bash demo/trial.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEMO_DIR=$(mktemp -d)

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

cleanup() {
  rm -rf "$DEMO_DIR"
}
trap cleanup EXIT

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║     @loop-eng/kit — Interactive Demo     ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${RESET}"
echo ""

# Build the CLI first
echo -e "${DIM}Building kit CLI...${RESET}"
(cd "$PROJECT_DIR" && npm run build > /dev/null 2>&1)
CLI_JS="$PROJECT_DIR/dist/cli.js"
kit() { node "$CLI_JS" "$@"; }

# ─── Phase 1: TypeScript Project ───
echo ""
echo -e "${BOLD}Phase 1: Scaffold a TypeScript loop${RESET}"
echo -e "${DIM}────────────────────────────────────${RESET}"

TS_DIR="$DEMO_DIR/ts-project"
mkdir -p "$TS_DIR"
echo '{"name":"demo-ts","scripts":{"test":"echo ok"}}' > "$TS_DIR/package.json"
echo '{}' > "$TS_DIR/tsconfig.json"
echo '{}' > "$TS_DIR/vitest.config.ts"

echo -e "${CYAN}→ kit init --yes --dir $TS_DIR${RESET}"
kit init --yes --dir "$TS_DIR" 2>&1 | head -20
echo ""

echo -e "${CYAN}→ kit score --dir $TS_DIR${RESET}"
kit score --dir "$TS_DIR"
echo ""

echo -e "${CYAN}→ kit status --dir $TS_DIR${RESET}"
kit status --dir "$TS_DIR"

# ─── Phase 2: Template-Based Init ───
echo ""
echo -e "${BOLD}Phase 2: Use a template (fix-types)${RESET}"
echo -e "${DIM}────────────────────────────────────${RESET}"

TMPL_DIR="$DEMO_DIR/tmpl-project"
mkdir -p "$TMPL_DIR"
echo '{"name":"demo-tmpl"}' > "$TMPL_DIR/package.json"
echo '{}' > "$TMPL_DIR/tsconfig.json"

echo -e "${CYAN}→ kit init --template fix-types --dir $TMPL_DIR${RESET}"
kit init --template fix-types --dir "$TMPL_DIR" 2>&1 | head -20
echo ""

echo -e "${CYAN}→ Generated budget.yaml:${RESET}"
cat "$TMPL_DIR/.loop/budget.yaml"
echo ""

# ─── Phase 3: Go Project ───
echo ""
echo -e "${BOLD}Phase 3: Scaffold a Go project loop${RESET}"
echo -e "${DIM}────────────────────────────────────${RESET}"

GO_DIR="$DEMO_DIR/go-project"
mkdir -p "$GO_DIR"
echo 'module example.com/demo' > "$GO_DIR/go.mod"

echo -e "${CYAN}→ kit init --yes --dir $GO_DIR${RESET}"
kit init --yes --dir "$GO_DIR" 2>&1 | head -20
echo ""

echo -e "${CYAN}→ kit score --dir $GO_DIR${RESET}"
kit score --dir "$GO_DIR"

# ─── Phase 4: Template Browser ───
echo ""
echo -e "${BOLD}Phase 4: Browse templates${RESET}"
echo -e "${DIM}────────────────────────────────────${RESET}"

echo -e "${CYAN}→ kit templates${RESET}"
kit templates

echo -e "${CYAN}→ kit templates --search security${RESET}"
kit templates --search security

# ─── Phase 5: Unconfigured Project ───
echo ""
echo -e "${BOLD}Phase 5: Score an unconfigured project${RESET}"
echo -e "${DIM}────────────────────────────────────${RESET}"

EMPTY_DIR="$DEMO_DIR/empty-project"
mkdir -p "$EMPTY_DIR"

echo -e "${CYAN}→ kit score --dir $EMPTY_DIR${RESET}"
kit score --dir "$EMPTY_DIR"

# ─── Summary ───
echo ""
echo -e "${GREEN}${BOLD}Demo complete!${RESET}"
echo -e "${DIM}All phases ran successfully.${RESET}"
echo ""
