#!/usr/bin/env bash
set -euo pipefail

# Kit E2E Test Suite
# Run: bash demo/test_e2e.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEMO_DIR=$(mktemp -d)

PASS=0
FAIL=0

GREEN='\033[0;32m'
RED='\033[0;31m'
BOLD='\033[1m'
RESET='\033[0m'

cleanup() {
  rm -rf "$DEMO_DIR"
}
trap cleanup EXIT

# Build CLI
(cd "$PROJECT_DIR" && npm run build > /dev/null 2>&1)
CLI_JS="$PROJECT_DIR/dist/cli.js"

kit() {
  node "$CLI_JS" "$@"
}

assert_pass() {
  local desc="$1"
  shift
  if "$@" > /dev/null 2>&1; then
    echo -e "  ${GREEN}✓${RESET} $desc"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}✗${RESET} $desc"
    FAIL=$((FAIL + 1))
  fi
}

assert_file() {
  local desc="$1"
  local path="$2"
  if [ -f "$path" ]; then
    echo -e "  ${GREEN}✓${RESET} $desc"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}✗${RESET} $desc (missing: $path)"
    FAIL=$((FAIL + 1))
  fi
}

assert_contains() {
  local desc="$1"
  local path="$2"
  local pattern="$3"
  if grep -q "$pattern" "$path" 2>/dev/null; then
    echo -e "  ${GREEN}✓${RESET} $desc"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}✗${RESET} $desc (pattern '$pattern' not found in $path)"
    FAIL=$((FAIL + 1))
  fi
}

assert_output_contains() {
  local desc="$1"
  local pattern="$2"
  shift 2
  local output
  output=$("$@" 2>&1) || true
  if echo "$output" | grep -q "$pattern"; then
    echo -e "  ${GREEN}✓${RESET} $desc"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}✗${RESET} $desc (pattern '$pattern' not in output)"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo -e "${BOLD}@loop-eng/kit E2E Test Suite${RESET}"
echo ""

# ─── Test 1: Init (non-interactive) ───
echo -e "${BOLD}1. Init (--yes) for TypeScript project${RESET}"
T1_DIR="$DEMO_DIR/t1"
mkdir -p "$T1_DIR"
echo '{"name":"t1","scripts":{"test":"vitest run"}}' > "$T1_DIR/package.json"
echo '{}' > "$T1_DIR/tsconfig.json"
echo '' > "$T1_DIR/vitest.config.ts"

assert_pass "kit init --yes runs without error" kit init --yes --dir "$T1_DIR"
assert_file "CLAUDE.md created" "$T1_DIR/CLAUDE.md"
assert_file "verify.sh created" "$T1_DIR/.loop/verify.sh"
assert_file "claude hooks verify.sh created" "$T1_DIR/.claude/hooks/verify.sh"
assert_file "goal.md created" "$T1_DIR/.loop/goal.md"
assert_file "budget.yaml created" "$T1_DIR/.loop/budget.yaml"
assert_file "ltf.config.yaml created" "$T1_DIR/.loop/ltf.config.yaml"
assert_file "state.md created" "$T1_DIR/.loop/state.md"
assert_contains "CLAUDE.md has verification gate" "$T1_DIR/CLAUDE.md" "Verification Gate"
assert_contains "CLAUDE.md has loop protocol" "$T1_DIR/CLAUDE.md" "Loop Protocol"
assert_contains "budget.yaml has cost cap" "$T1_DIR/.loop/budget.yaml" "max_cost_usd"
assert_contains "budget.yaml has convergence" "$T1_DIR/.loop/budget.yaml" "stall_iterations"
assert_contains "verify.sh has shebang" "$T1_DIR/.loop/verify.sh" "#!/usr/bin/env bash"
echo ""

# ─── Test 2: Init with template ───
echo -e "${BOLD}2. Init with --template fix-types${RESET}"
T2_DIR="$DEMO_DIR/t2"
mkdir -p "$T2_DIR"
echo '{"name":"t2"}' > "$T2_DIR/package.json"
echo '{}' > "$T2_DIR/tsconfig.json"

assert_pass "kit init --template fix-types runs" kit init --template fix-types --dir "$T2_DIR"
assert_file "CLAUDE.md created" "$T2_DIR/CLAUDE.md"
assert_contains "budget has template iterations" "$T2_DIR/.loop/budget.yaml" "max_iterations: 10"
assert_contains "budget has template verify command" "$T2_DIR/.loop/budget.yaml" "npx tsc --noEmit"
echo ""

# ─── Test 3: Init for Go project ───
echo -e "${BOLD}3. Init for Go project${RESET}"
T3_DIR="$DEMO_DIR/t3"
mkdir -p "$T3_DIR"
echo 'module example' > "$T3_DIR/go.mod"

assert_pass "kit init --yes for Go project" kit init --yes --dir "$T3_DIR"
assert_contains "CLAUDE.md detects Go stack" "$T3_DIR/CLAUDE.md" "go"
assert_contains "budget uses go test" "$T3_DIR/.loop/budget.yaml" "go test"
echo ""

# ─── Test 4: Init for Python project ───
echo -e "${BOLD}4. Init for Python project${RESET}"
T4_DIR="$DEMO_DIR/t4"
mkdir -p "$T4_DIR"
echo '[tool.pytest.ini_options]' > "$T4_DIR/pyproject.toml"

assert_pass "kit init --yes for Python project" kit init --yes --dir "$T4_DIR"
assert_contains "CLAUDE.md detects Python stack" "$T4_DIR/CLAUDE.md" "python"
assert_contains "budget uses pytest" "$T4_DIR/.loop/budget.yaml" "pytest"
echo ""

# ─── Test 5: Templates command ───
echo -e "${BOLD}5. Templates command${RESET}"
assert_output_contains "templates lists all templates" "fix-types" kit templates
assert_output_contains "templates search finds matches" "fix-lint" kit templates --search fix
assert_output_contains "templates search returns no matches" "No templates matching" kit templates --search zzzznonexistent
echo ""

# ─── Test 6: Status command ───
echo -e "${BOLD}6. Status command${RESET}"
assert_output_contains "status shows loop state" "not_started" kit status --dir "$T1_DIR"
assert_output_contains "status shows budget" "Cost cap" kit status --dir "$T1_DIR"
assert_output_contains "status handles unconfigured project" "No loop configured" kit status --dir "$DEMO_DIR"
echo ""

# ─── Test 7: Score command ───
echo -e "${BOLD}7. Score command${RESET}"
assert_output_contains "score shows high score for scaffolded project" "/100" kit score --dir "$T1_DIR"
assert_output_contains "score shows low score for empty project" "/100" kit score --dir "$DEMO_DIR"
assert_output_contains "score shows agent config check" "Agent config" kit score --dir "$T1_DIR"
echo ""

# ─── Test 8: Invalid template ───
echo -e "${BOLD}8. Edge cases${RESET}"
T8_DIR="$DEMO_DIR/t8"
mkdir -p "$T8_DIR"
assert_output_contains "invalid template name shows error" "not found" kit init --template nonexistent --dir "$T8_DIR"
echo ""

# ─── Test 9: Gitignore update ───
echo -e "${BOLD}9. Gitignore management${RESET}"
assert_file ".gitignore created" "$T1_DIR/.gitignore"
assert_contains ".gitignore has state.md" "$T1_DIR/.gitignore" ".loop/state.md"
assert_contains ".gitignore has trace file" "$T1_DIR/.gitignore" ".loop/trace.ltf.jsonl"
echo ""

# ─── Test 10: Idempotent init ───
echo -e "${BOLD}10. Idempotent init (re-run doesn't crash)${RESET}"
assert_pass "re-running init --yes succeeds" kit init --yes --dir "$T1_DIR"
echo ""

# ─── Test 11: CLI help ───
echo -e "${BOLD}11. CLI help and version${RESET}"
assert_output_contains "help shows all commands" "init" kit --help
EXPECTED_VERSION=$(node -p "require('$PROJECT_DIR/package.json').version")
assert_output_contains "version flag works" "$EXPECTED_VERSION" kit --version
echo ""

# ─── Summary ───
TOTAL=$((PASS + FAIL))
echo -e "${BOLD}Results: ${GREEN}$PASS passed${RESET}, ${RED}$FAIL failed${RESET} (${TOTAL} total)"
echo ""

if [ $FAIL -gt 0 ]; then
  exit 1
fi
