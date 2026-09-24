# Contributing to @loop-eng/kit

Thanks for considering a contribution. This project is small and young — this guide covers
what you actually need, not a full governance process.

## Development setup

```bash
git clone https://github.com/loop-eng/kit.git
cd kit
npm install
npm run build
npm test
```

Before opening a PR, all of these should pass:

```bash
npm run typecheck   # tsc --noEmit
npm run lint         # eslint src/
npm run build        # tsup
npm test             # vitest run
bash demo/test_e2e.sh   # end-to-end suite against a real built CLI
```

CI runs the same checks on Linux (Node 20 + 22) and a Windows smoke job — it's the final
gate, matching whatever `npm test` and `demo/test_e2e.sh` report locally.

## Adding a template

Templates live in `templates/*.yaml` and are loaded by `src/templates/registry.ts`. There is
no separate submission process or remote registry — a template becomes available by adding
a YAML file to that directory and opening a PR.

### Required schema

```yaml
name: my-template              # required, string — used as the --template value
description: "One-line summary"  # required, string
tags: [tag-one, tag-two]         # optional, array — defaults to [] if omitted
goal: |                          # required, string — becomes the agent's task
  Multi-line description of what the agent should do.
verification:
  command: "npm test"            # required, string — must actually be runnable
  description: "Tests pass"      # optional (not currently validated, but keep it accurate)
budget:
  suggested_usd: 10              # required, number, MUST BE > 0
  suggested_iterations: 10       # required, number, MUST BE > 0
agent_instructions:
  claude-code: |                 # optional per-agent instructions, hyphenated keys
    Extra instructions injected into CLAUDE.md.
  codex: |
    Extra instructions injected into AGENTS.md.
  gemini: |
    Extra instructions injected into GEMINI.md.
  cursor: |
    Extra instructions injected into .cursorrules.
```

### Two gotchas that will silently break your PR

1. **`agent_instructions` keys are hyphenated** (`claude-code`, not `claude_code`). This
   matches the `AgentType` union in `src/types.ts`. Get it wrong and your instructions are
   silently dropped — the loader looks up `agent_instructions["claude-code"]` and a missing
   key is treated as "no instructions for this agent," not an error. (If you're basing your
   template on an older doc or blog post that shows `claude_code` with an underscore, that
   example is wrong — verify against `src/types.ts`'s `AgentType` union instead.)

2. **`budget.suggested_usd` and `budget.suggested_iterations` must both be greater than
   zero.** `src/templates/registry.ts` validates this and silently skips any template that
   fails — your template just won't show up in `kit templates`, with no error message. If
   you add a template and it doesn't appear, check these two fields first.

None of the 6 built-in templates currently define `cursor`-specific instructions — Cursor
falls back to whatever `claude-code` instructions exist. You don't need to add a `cursor`
key unless your template genuinely needs Cursor-specific guidance.

### Verifying your template loads

```bash
npm run build
node dist/cli.js templates            # your template should appear in the list
node dist/cli.js templates --search your-tag
node dist/cli.js init --template your-template-name --dir /tmp/some-test-project --yes
```

## Code conventions

- TypeScript, ES2022 target, strict mode (`tsconfig.json`).
- ESLint flat config (`eslint.config.js`) — `no-explicit-any` is off, `no-console` is a
  warning (CLI output uses `// eslint-disable-next-line no-console` per line, matching the
  existing style in `src/cli/*.ts`).
- Tests live in `__tests__/` directories next to the code they cover, using vitest.
- Prefer exporting a function for direct unit testing over adding indirection layers —
  see `src/cli/status.ts` and `src/cli/score.ts` for the pattern used to make CLI command
  internals testable without mocking the terminal.

## What this project is not looking for right now

- A remote/community template registry — templates are contributed via PR to this repo,
  not fetched at runtime. This may change if PR volume ever makes that a bottleneck.
- Governance documents, CLA, or elaborate issue/PR templates — revisit if the contributor
  base grows past a handful of regular contributors.
