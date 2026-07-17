# @loop-eng/kit

> Create production-ready agent loops in 30 seconds — zero to loop with one command.

[![CI](https://github.com/loop-eng/kit/actions/workflows/ci.yml/badge.svg)](https://github.com/loop-eng/kit/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@loop-eng/kit)](https://www.npmjs.com/package/@loop-eng/kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## The Problem

Setting up a production-quality agent loop takes 30-60 minutes per project: reading docs, writing hooks, configuring budget caps, wiring up state tracking. Most developers either skip this (and get runaway loops) or copy-paste from prior projects (and accumulate drift).

## The Solution

```bash
npx @loop-eng/kit init
```

Five questions. Six files. Production-ready loop.

```
  ┌  @loop-eng/kit v0.1
  │
  ◇  What's the task?
  │  Fix all TypeScript errors in src/
  │
  ◇  How do you verify success?
  │  ● Test suite (npx vitest run)
  │
  ◇  Budget cap?
  │  ● $20 (feature work)
  │
  ◇  Which agent?
  │  ● Claude Code
  │
  ◇  Iteration limit?
  │  ● 10 (standard)
  │
  ◆  Files created
  │  ✓ CLAUDE.md
  │  ✓ .claude/hooks/verify.sh
  │  ✓ .loop/goal.md
  │  ✓ .loop/budget.yaml
  │  ✓ .loop/ltf.config.yaml
  │  ✓ .loop/state.md
  │
  └  Run claude to start your loop
```

## Features

| Feature | Description |
|---------|-------------|
| Interactive wizard | Clack-powered prompts — 5 questions, beautiful UI |
| Auto-detection | Detects stack (TS/JS/Python/Go/Rust), test runner, installed agents |
| Cross-agent support | Generates configs for Claude Code, Codex CLI, Gemini CLI, Cursor |
| Template library | 6 built-in templates for common tasks |
| Verification gates | Auto-generates hook scripts that enforce pass/fail |
| Budget enforcement | Cost caps, iteration limits, convergence criteria |
| LTF integration | Every loop emits LTF traces by default |
| Loop readiness score | `kit score` rates your loop setup 0-100 |
| Loop status | `kit status` shows progress from LTF traces |

## Installation

```bash
# Use directly with npx (no install needed)
npx @loop-eng/kit init

# Or install globally
npm install -g @loop-eng/kit
```

## Commands

### `kit init` — Scaffold a loop

```bash
kit init                        # Interactive wizard
kit init --template fix-types   # Use a specific template
kit init --yes                  # Accept all defaults (non-interactive)
kit init --dir ./my-project     # Target a specific directory
```

### `kit templates` — Browse templates

```bash
kit templates                   # List all templates
kit templates --search security # Search by name or tag
```

**Built-in templates:**

| Template | Task | Verification |
|----------|------|--------------|
| `fix-types` | Fix TypeScript errors | `tsc --noEmit` |
| `fix-lint` | Fix linting errors | `eslint --max-warnings=0` |
| `add-tests` | Add test coverage | `npm test` |
| `migrate-api` | Migrate deprecated APIs | Build + tests |
| `dependency-update` | Update outdated deps | Full test suite |
| `security-audit` | Fix vulnerabilities | `npm audit` |

### `kit score` — Rate loop readiness

```bash
kit score                       # Score current project
kit score --dir ./my-project    # Score a specific directory
```

Checks for: agent config, goal definition, verification gate, budget config, state tracking, LTF config, stack detection, test runner, installed agents, convergence criteria.

### `kit status` — Show loop progress

```bash
kit status                      # Show loop status
kit status --dir ./my-project   # Status for a specific directory
```

Shows: current iteration, loop state, budget remaining, LTF trace summary (cost, tokens, duration).

## Generated Files

```
project/
├── CLAUDE.md               # Loop instructions for the agent
├── .claude/
│   └── hooks/
│       └── verify.sh       # Verification gate script
├── .loop/
│   ├── goal.md             # Goal definition
│   ├── state.md            # Loop state tracking
│   ├── budget.yaml         # Budget caps + convergence criteria
│   └── ltf.config.yaml     # LTF trace emission config
└── .gitignore              # Updated with .loop/state.md
```

### Budget Configuration

```yaml
budget:
  max_cost_usd: 20
  max_iterations: 10
  max_duration_minutes: 60
verification:
  command: npm test
  must_pass: true
  retry_on_fail: true
convergence:
  stall_iterations: 3       # Stop if no progress for 3 iterations
  same_error_threshold: 2   # Stop if same error repeats 2x
ltf:
  enabled: true
  output: .loop/trace.ltf.jsonl
```

## Auto-Detection

Kit auto-detects your project to provide intelligent defaults:

| Detected | Source | Default Verification |
|----------|--------|---------------------|
| TypeScript | `tsconfig.json` | `tsc --noEmit` |
| Vitest | `vitest.config.*` | `npx vitest run` |
| Jest | `jest.config.*` | `npx jest` |
| Pytest | `pyproject.toml[tool.pytest]` | `pytest` |
| Go | `go.mod` | `go test ./...` |
| ESLint | `eslint.config.*` | `npx eslint .` |
| Ruff | `ruff.toml` | `ruff check .` |

## Architecture

```
src/
├── cli/           # Commander-based CLI commands
├── detectors/     # Auto-detect stack, test runner, agents
├── generators/    # Generate CLAUDE.md, hooks, budget, goal, LTF config
├── templates/     # Template registry and loader
└── utils/         # File system and git helpers
```

## Competitive Landscape

| Feature | kit | loop-init | spec-kit | claude-code-templates |
|---------|-----|-----------|----------|----------------------|
| Interactive wizard | ✓ (Clack) | ✗ | ✗ | ✗ |
| Loop-specific output | ✓ | ✓ | ✗ | ✗ |
| Cross-agent support | ✓ (4 agents) | Partial | ✓ | Claude only |
| LTF integration | ✓ | ✗ | ✗ | ✗ |
| Verification gates | Generated | Scored | Manual | Manual |
| Budget enforcement | Generated | Estimated | ✗ | ✗ |
| Template ecosystem | ✓ (6 built-in) | 7 patterns | 3 templates | 600+ |

## Development

```bash
npm install          # Install dependencies
npm run build        # Build with tsup
npm run typecheck    # Type check
npm run lint         # Lint with ESLint
npm run test         # Run tests with vitest
bash demo/trial.sh   # Run interactive demo
bash demo/test_e2e.sh # Run E2E test suite
```

## Part of the Loop Engineering Ecosystem

- **[loopguard](https://github.com/loop-eng/loopguard)** — Runtime guardian for AI agent loops
- **[ltf](https://github.com/loop-eng/ltf)** — Loop Trace Format specification and parsers
- **[loopctl](https://github.com/loop-eng/loopctl)** — htop for AI agent sessions
- **[kit](https://github.com/loop-eng/kit)** — Loop scaffolding CLI (this project)

## License

MIT
