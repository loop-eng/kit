# @loop-eng/kit

> Scaffold a production-ready agent loop — CLAUDE.md, verification gates, budget caps, and LTF traces — in one command.

[![CI](https://github.com/loop-eng/kit/actions/workflows/ci.yml/badge.svg)](https://github.com/loop-eng/kit/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@loop-eng/kit)](https://www.npmjs.com/package/@loop-eng/kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## The Problem

Setting up a production-quality agent loop takes 30-60 minutes per project: reading docs, writing hooks, configuring budget caps, wiring up state tracking. Most developers either skip this (and get runaway loops) or copy-paste from prior projects (and accumulate drift).

## The Solution

```bash
npx @loop-eng/kit init
```

```
  ┌  @loop-eng/kit
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
  │  ○ Claude Code   ○ Codex CLI   ○ Gemini CLI   ● All (multi-agent)
  │
  ◇  Iteration limit?
  │  ● 10 (standard)
  │
  ◆  Files created
  │  ✓ CLAUDE.md   ✓ AGENTS.md   ✓ GEMINI.md   ✓ .cursorrules
  │  ✓ .loop/verify.sh          ✓ .claude/hooks/verify.sh
  │  ✓ .loop/goal.md            ✓ .loop/budget.yaml
  │  ✓ .loop/ltf.config.yaml    ✓ .loop/kit.json
  │
  └  Run claude / codex / gemini / cursor to start your loop
```

## Why trust this

This project runs an unusually blunt audit process on itself: every phase of implementation
goes through adversarial code review before shipping, and every finding — including the
ones that turned out to be false alarms — is logged in [`FINDINGS.md`](FINDINGS.md). That
file currently documents 16 real bugs found and fixed (including a critical one caught by
the project's own test suite before it ever shipped: a verify command containing a plain
`exit` call would silently kill the entire verification script). If you want evidence this
was actually tested rather than just described, that file is where to look.

## Features

| Feature | Description |
|---------|-------------|
| Interactive wizard | Clack-powered prompts — 5 questions, beautiful UI |
| Auto-detection | Detects stack (TS/JS/Python/Go/Rust), test runner, installed agents |
| Multi-agent scaffolding | Generate configs for Claude Code, Codex CLI, Gemini CLI, and Cursor in one run |
| Template library | 6 built-in templates for common tasks |
| Verification gates | Auto-generates a hook script that enforces pass/fail and traces every run |
| Budget configuration | Cost caps, iteration limits, convergence criteria |
| LTF trace emission | Every verification run appends a real, spec-shaped `.loop/trace.ltf.jsonl` event |
| Loop readiness score | `kit score` rates your loop setup 0-100, with multi-agent-aware scoring |
| Loop status | `kit status` shows progress from LTF traces |

## Installation

```bash
# Use directly with npx (no install needed)
npx @loop-eng/kit init

# Or install globally
npm install -g @loop-eng/kit
```

**Windows:** the generated verification hook is a bash script. Install Git for Windows
(includes Git Bash) or use WSL — `kit init` will warn you at scaffold time if neither is
detected.

## Commands

### `kit init` — Scaffold a loop

```bash
kit init                                  # Interactive wizard
kit init --template fix-types             # Use a specific template
kit init --yes                            # Accept all defaults (non-interactive)
kit init --agent codex                    # Scaffold for a single agent, skipping the wizard prompt
kit init --agent claude-code,codex        # Scaffold for multiple specific agents
kit init --agent all                      # Scaffold for all 4 supported agents
kit init --dir ./my-project               # Target a specific directory
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

Want to add one? See [CONTRIBUTING.md](CONTRIBUTING.md#adding-a-template).

### `kit score` — Rate loop readiness

```bash
kit score                       # Score current project
kit score --dir ./my-project    # Score a specific directory
```

Checks for: agent config (proportional credit across all scaffolded agents), goal
definition, verification gate, budget config, state tracking, LTF config, stack detection,
test runner, installed agents, convergence criteria.

### `kit status` — Show loop progress

```bash
kit status                      # Show loop status
kit status --dir ./my-project   # Status for a specific directory
```

Shows: current iteration, loop state, budget remaining, and a real LTF trace summary
(duration, and cost/tokens if your agent self-reports them — kit's own verification hook
can only observe pass/fail and timing, not model usage; see [LTF trace emission](#ltf-trace-emission) below).

## Generated Files

```
project/
├── CLAUDE.md / AGENTS.md / GEMINI.md / .cursorrules   # One per scaffolded agent
├── .claude/
│   └── hooks/
│       └── verify.sh       # Convention copy for Claude Code / Cursor users
├── .loop/
│   ├── verify.sh           # The verification gate + LTF trace emitter (shared by all agents)
│   ├── goal.md             # Goal definition
│   ├── state.md            # Loop state tracking (agent-maintained)
│   ├── budget.yaml         # Budget caps + convergence criteria
│   ├── ltf.config.yaml     # What the LTF trace actually captures (and doesn't)
│   ├── kit.json            # Records which agents were scaffolded, for `kit score`
│   └── trace.ltf.jsonl     # Generated at runtime — gitignored
└── .gitignore              # Updated with .loop/state.md and the trace files
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

Budget caps and convergence criteria are generated as configuration for your agent to
follow — kit does not yet run a supervising process that enforces them at runtime (that
would be a `kit run` command; see [Architecture](#architecture) for what's built today).

### LTF Trace Emission

The generated `.loop/verify.sh` appends one real [LTF](https://github.com/loop-eng/ltf)
event to `.loop/trace.ltf.jsonl` every time verification runs — a `verify`-phase event with
the command, exit code, and duration, plus a `terminate` event and a `loop_summary` the
first time verification passes. This works identically across all four agents because it
lives in the shared verification hook, not in agent-specific instrumentation.

What it can't capture: `cost_usd` and token counts. A verification script has no visibility
into the agent's own model calls — that data can only come from the agent itself, and no
shipped agent CLI currently exposes it through a mechanism kit's hook can observe. If
`kit status` shows a cost or token figure, your agent is self-reporting it; if it doesn't,
that's expected, not a bug.

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

Kit is a one-shot scaffolding CLI: it generates files and exits. It does not stay running
while your agent works, and does not (yet) supervise the loop itself — that's a documented
gap, not a hidden one.

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

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full setup and template contribution guide.

## Part of the Loop Engineering Ecosystem

- **[loopguard](https://github.com/loop-eng/loopguard)** — Runtime guardian for AI agent loops
- **[ltf](https://github.com/loop-eng/ltf)** — Loop Trace Format specification and parsers
- **[loopctl](https://github.com/loop-eng/loopctl)** — htop for AI agent sessions
- **[kit](https://github.com/loop-eng/kit)** — Loop scaffolding CLI (this project)

## License

MIT
