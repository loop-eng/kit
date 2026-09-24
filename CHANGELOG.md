# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Real LTF trace emission: the generated verification hook now appends spec-shaped
  `.loop/trace.ltf.jsonl` entries (`verify`/`terminate` phase events and a `loop_summary`
  on success) instead of only generating a config file that described intended tracing.
- Multi-agent scaffolding: `kit init` can now generate configs for multiple agents in
  one run via the wizard's "All (multi-agent)" option or `--agent <agents>` (comma-separated
  or `all`). A `.loop/kit.json` manifest records which agents were selected.
- `kit score` gives proportional credit for multi-agent setups based on the recorded
  manifest, falling back to the original any-one-file check for pre-existing projects.
- Cursor now falls back to a template's `claude-code` instructions when no `cursor`-specific
  instructions are defined (no shipped template currently defines them).
- A one-time warning when running on Windows without bash on PATH, since the generated
  verification hook is a bash script (documented prerequisite: Git Bash or WSL).
- CI now includes a Windows smoke job in addition to the existing Linux matrix.

### Fixed
- **Critical**: a verify command containing a literal `exit` call (a common shell idiom)
  would terminate the entire generated hook script before capturing the exit code or
  emitting any trace — never surfaced because no prior test exercised this pattern.
  Fixed by running the verify command in a subshell.
- `src/cli/status.ts`'s trace reader modeled `tokens` as a flat number instead of the
  real LTF nested `{input, output, cached, cache_write}` shape, and had no concept of
  `loop_summary` records; both are now handled correctly, with parse-failure counts
  surfaced instead of silently dropped.
- `.loop/ltf.config.yaml`'s field list omitted `ltf_version`/`loop_id`/`phase` — the
  four fields every real LTF event requires — while claiming to describe the trace
  schema. Corrected to state plainly what's captured (verify-phase events only; no
  cost/token data, since the hook has no visibility into agent model calls).

## [0.1.0] — 2026-07-27

Initial release.

### Added
- `kit init` — interactive Clack-based wizard, `--yes` non-interactive mode, and
  `--template <name>` for scaffolding from a built-in template.
- Auto-detection of project stack (TypeScript/JavaScript/Python/Go/Rust), test runner
  (vitest/jest/mocha/pytest/go-test/cargo-test), linter (ESLint/Ruff), and installed
  agent CLIs.
- Generators for `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursorrules`, a bash
  verification hook, `.loop/goal.md`, `.loop/budget.yaml`, and `.loop/ltf.config.yaml`.
- `kit templates` — browse and search 6 built-in templates (fix-types, fix-lint,
  add-tests, migrate-api, dependency-update, security-audit).
- `kit score` — loop readiness score (0-100) across 10 criteria.
- `kit status` — reads `.loop/state.md`, `.loop/budget.yaml`, and LTF traces.
