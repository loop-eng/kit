# Phase 2: Multi-Agent Generation — Implementation Plan

Status: **planning only, no code written**
Target: `@loop-eng/kit` v0.1.0 → v0.2.0
Scope: close the "All (multi-agent)" gap between the product vision (`ideas/04-kit.md`) and the current single-agent implementation.

---

## 1. Problem Statement

`ideas/04-kit.md` specifies the wizard's agent question as a **multi-select with an "All" option**:

```
ideas/04-kit.md:72-77
  ◇  Which agent?
  │  ● Claude Code
  │  ○ Codex CLI
  │  ○ Gemini CLI
  │  ○ All (multi-agent)
```

and lists "Cross-agent support" (generating CLAUDE.md, AGENTS.md, GEMINI.md simultaneously) as Kit's core differentiator versus every competitor (`ideas/04-kit.md:40-48`, the "Kit's unique value" competitive table at `ideas/04-kit.md:296-310`).

The current implementation only supports picking **one** agent per run:

- `src/types.ts:18` — `AgentType` is a flat string union with no array/collection variant.
- `src/types.ts:33` — `WizardAnswers.agent: AgentType` (singular field name, singular type).
- `src/cli/init.ts:166-177` — the wizard's "Which agent?" prompt is a `p.select()` (single choice), not a `p.multiselect()`. There is no "All" entry.
- `src/cli/init.ts:36-40` — `initCommand` has `--template`, `--yes`, `--dir` flags but no `--agent` flag at all; there is no non-interactive way to request more than one agent.
- `src/generators/index.ts:78-105` — `generateAgentConfig()` (singular name, singular return) is a `switch` over one `AgentType` that returns exactly one `{ path, content }` pair. `generateAll()` calls it exactly once (`src/generators/index.ts:31-33`) and pushes exactly one agent file into the output list.
- `src/generators/index.ts:41-46` — the `.claude/hooks/verify.sh` duplication is gated on `answers.agent === "claude-code" || answers.agent === "cursor"`, an equality check that only works because `answers.agent` is a scalar.
- `src/cli/score.ts:88-95` — "Agent config" is a single 15-point line item that is satisfied by the presence of *any one* of the four output files; it has no concept of "how many of the agents the team actually uses are covered."

Net effect: a team with some developers on Claude Code and some on Codex cannot get one `kit init` run to produce consistent CLAUDE.md + AGENTS.md today. They must run `kit init` twice (into the same directory, non-destructively for existing files given the "files overwritten on re-run" design choice per `FINDINGS.md:142`), and must be careful to answer identically both times (same goal, same budget, same verification command) or the two agents will drift — the exact failure mode Kit exists to prevent per `ideas/04-kit.md:22` ("copy-paste from prior projects and accumulate drift").

---

## 2. API Design

### 2.1 Type changes (`src/types.ts`)

```ts
// BEFORE
export interface WizardAnswers {
  task: string;
  verification: VerificationMethod;
  customCommand?: string;
  budget: BudgetTier;
  agent: AgentType;
  iterations: number;
}

// AFTER
export interface WizardAnswers {
  task: string;
  verification: VerificationMethod;
  customCommand?: string;
  budget: BudgetTier;
  agents: AgentType[];   // renamed agent -> agents; always non-empty, de-duplicated,
                          // rendered in canonical order (see 3.2)
  iterations: number;
}
```

`AgentType` itself (`src/types.ts:18`) is **unchanged** — it stays a flat union of the four concrete agent identifiers. `"all"` is never a valid `AgentType`; it is only a *user-facing shorthand* that gets expanded to `["claude-code", "codex", "gemini", "cursor"]` at the CLI/wizard boundary, before a `WizardAnswers` object is ever constructed. This keeps every downstream consumer (`generators/index.ts`, `score.ts`, templates) working with a plain array of real agent identifiers and never needing to special-case a sentinel value.

This is a field **rename** (`agent` → `agents`), not just a type change, so every call site fails to compile until updated — that's intentional; it converts "did you forget to handle the array?" into a compiler error instead of a silent single-agent bug.

`WizardAnswers` is re-exported from the package root (`src/index.ts:3-11`), so this is a **public, breaking type change** for any programmatic consumer of `@loop-eng/kit`. Since the package is pre-1.0 (`package.json` version `0.1.0`), this is permitted by semver without a major bump, but it should land as **v0.2.0** (minor, not patch) and be called out in the CHANGELOG. See §7.

### 2.2 CLI flag (`src/cli/init.ts`)

Add a new flag, wired the same way `--template` and `--yes` already are (`src/cli/init.ts:36-40`):

```ts
export const initCommand = new Command("init")
  .description("Scaffold a production-ready agent loop")
  .option("-t, --template <name>", "use a specific template")
  .option("-a, --agent <agents>", "comma-separated agents, or 'all' (claude-code, codex, gemini, cursor)")
  .option("-y, --yes", "accept all defaults (non-interactive)")
  .option("-d, --dir <path>", "target directory", ".")
```

```ts
interface InitOptions {
  template?: string;
  agent?: string;   // raw, comma-separated CLI value; parsed via parseAgentFlag()
  yes?: boolean;
  dir: string;
}
```

Syntax (matches the task's proposed examples exactly):

| Invocation | Resulting `agents` |
|---|---|
| `kit init --yes` | `[detectedOrDefault]` (unchanged, 1 agent) |
| `kit init --yes --agent all` | `["claude-code", "codex", "gemini", "cursor"]` |
| `kit init --yes --agent claude-code,codex` | `["claude-code", "codex"]` |
| `kit init --yes --agent CLAUDE-CODE, Codex` | `["claude-code", "codex"]` (case-insensitive, trims whitespace) |
| `kit init --yes --agent claude-code,claude-code` | `["claude-code"]` (deduped) |
| `kit init --yes --agent bogus` | error, exit 1: `` Unknown agent "bogus". Valid agents: claude-code, codex, gemini, cursor, all `` |
| `kit init --template fix-types --agent all` | template's goal/verification/budget + all 4 agent files |
| `kit init` (interactive, no flag) | wizard's multiselect asks; see §4 |
| `kit init --agent all` (interactive, flag given) | wizard runs, but the "Which agent?" step is **skipped** — pre-seeded from the flag (mirrors how `--template` currently short-circuits the whole wizard, but here only one question is short-circuited, not the whole flow) |

New pure helper, extracted for unit-testability (§6):

```ts
// src/cli/parse-agents.ts
import type { AgentType } from "../types.js";

const ALL_AGENTS: AgentType[] = ["claude-code", "codex", "gemini", "cursor"];
const VALID = new Set<string>(ALL_AGENTS);

export class InvalidAgentError extends Error {}

export function parseAgentFlag(raw: string): AgentType[] {
  const tokens = raw
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);

  if (tokens.length === 0) {
    throw new InvalidAgentError("--agent requires at least one value");
  }

  const result = new Set<AgentType>();
  for (const token of tokens) {
    if (token === "all") {
      ALL_AGENTS.forEach((a) => result.add(a));
      continue;
    }
    if (!VALID.has(token)) {
      throw new InvalidAgentError(
        `Unknown agent "${token}". Valid agents: ${ALL_AGENTS.join(", ")}, all`,
      );
    }
    result.add(token as AgentType);
  }
  // canonical order, not insertion order (see 3.2)
  return ALL_AGENTS.filter((a) => result.has(a));
}
```

Call site in `initCommand.action`:

```ts
let presetAgents: AgentType[] | undefined;
if (opts.agent) {
  try {
    presetAgents = parseAgentFlag(opts.agent);
  } catch (err) {
    p.cancel(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
```

### 2.3 How single-agent and multi-agent modes coexist

Nothing downstream of `WizardAnswers` needs to know "am I in single or multi mode" — `generateAll` and `generateAgentConfigs` always iterate `answers.agents`, whether it has length 1 or 4. Single-agent behavior is simply the `length === 1` case of the same code path. This is the key design choice that keeps the change low-risk: **there is no branch for "multi-agent mode"; there is only "the array has N agents."**

Existing call sites that build a single agent keep building a **1-element array** instead of a bare string:

- `buildDefaults()` (`src/cli/init.ts:201-213`): `agents: detection.agents.length > 0 ? [detection.agents[0]] : ["claude-code"]` — unless `presetAgents` was supplied, in which case use that.
- Template branch (`src/cli/init.ts:62-68`): same pattern, `[detection.agents[0]] ?? ["claude-code"]`, overridable by `presetAgents`.
- Wizard (`runWizard`): if `presetAgents` is passed in, skip the "Which agent?" step and use it directly; otherwise run the new multiselect (§4) and return its expanded result.

---

## 3. Detailed Implementation Steps

### 3.1 `src/types.ts`
- Rename `WizardAnswers.agent` → `agents: AgentType[]`. No other type changes needed (`AgentType`, `DetectionResult.agents` are already correct as-is).

### 3.2 `src/cli/parse-agents.ts` (new file)
- Add `parseAgentFlag()` and `InvalidAgentError` as specified in §2.2.
- Export a `CANONICAL_AGENT_ORDER = ["claude-code", "codex", "gemini", "cursor"]` constant here (or in `types.ts`) and reuse it in `generators/index.ts` and `init.ts`'s wizard options list, so file-generation order, wizard-option order, and flag-expansion order are all driven from one source of truth instead of three independent orderings that could drift.

### 3.3 `src/cli/init.ts`
- Add `-a, --agent <agents>` option (§2.2).
- Add `presetAgents` parsing at the top of `.action()`, before the `--template` / `--yes` branches, so it's available to all three paths (template, `--yes`, interactive).
- Template branch (`src/cli/init.ts:62-68`): change `agent: detection.agents.length > 0 ? detection.agents[0] : "claude-code"` to `agents: presetAgents ?? (detection.agents.length > 0 ? [detection.agents[0]] : ["claude-code"])`.
- `--yes` branch (`src/cli/init.ts:73-77`): `buildDefaults(detection, verification.testCommand, presetAgents)`.
- Interactive branch (`src/cli/init.ts:95`): `runWizard(detection, verification.testCommand, presetAgents)`.
- `runWizard()` signature gains `presetAgents?: AgentType[]`:
  - if provided, skip the "Which agent?" prompt entirely (no `p.select`/`p.multiselect` call) and set the local `agents` variable to `presetAgents`.
  - otherwise, run the new multiselect prompt (full UX in §4) and use its (already-expanded) result.
- `buildDefaults()`: add optional 3rd param `presetAgents?: AgentType[]`; if present, use it for `agents`; otherwise keep today's single-detected-agent-or-claude-code logic, just array-wrapped.
- `runGeneration()`: no signature change needed — it already forwards the whole `answers` object into `generateAll`. Only the two lines that read `answers.agent` change:
  - `getStartHint(answers.agent)` → `getStartHints(answers.agents)` (§3.6 for output shape).
- Delete `getStartHint(agent: AgentType): string`, replace with:
  ```ts
  function getStartHints(agents: AgentType[]): string[] {
    return agents.map((agent) => {
      switch (agent) {
        case "claude-code": return "claude";
        case "codex": return "codex";
        case "gemini": return "gemini";
        case "cursor": return "cursor";
      }
    });
  }
  ```

### 3.4 `src/generators/index.ts`
- Rename `generateAgentConfig` → `generateAgentConfigs`, change its signature to loop over `answers.agents` (using the canonical order from §3.2, not selection order) and return `Array<{ path: string; content: string }>`:
  ```ts
  function generateAgentConfigs(
    opts: GenerateOptions,
    verifyCmd: string,
  ): { path: string; content: string }[] {
    const { answers, detection, verification, template } = opts;
    return CANONICAL_AGENT_ORDER
      .filter((agent) => answers.agents.includes(agent))
      .map((agent) => {
        const templateInstructions = template?.agent_instructions?.[agent] ?? null;
        switch (agent) {
          case "claude-code":
            return { path: "CLAUDE.md", content: generateClaudeMd(answers.task, verifyCmd, detection, verification, templateInstructions) };
          case "codex":
            return { path: "AGENTS.md", content: generateCodexMd(answers.task, verifyCmd, templateInstructions) };
          case "gemini":
            return { path: "GEMINI.md", content: generateGeminiMd(answers.task, verifyCmd, templateInstructions) };
          case "cursor":
            return { path: ".cursorrules", content: generateClaudeMd(answers.task, verifyCmd, detection, verification, templateInstructions) };
        }
      });
  }
  ```
  Note: no per-agent generator functions change signature (`generateClaudeMd`, `generateCodexMd`, `generateGeminiMd` are unchanged — they already take one `templateInstructions` string, which is looked up per-agent inside the loop, exactly like today's single-agent lookup at `src/generators/index.ts:81`, just repeated per iteration).
- `generateAll()` (`src/generators/index.ts:25-76`) changes:
  ```ts
  const agentFiles = generateAgentConfigs(opts, verifyCommand);
  for (const f of agentFiles) {
    writeFileSafe(join(dir, f.path), f.content);
    files.push(f.path);
  }
  const hookContent = generateHooks(verifyCommand);

  const loopHookPath = ".loop/verify.sh";
  writeFileSafe(join(dir, loopHookPath), hookContent);
  chmodSync(join(dir, loopHookPath), 0o755);
  files.push(loopHookPath);

  const needsClaudeHook = answers.agents.some((a) => a === "claude-code" || a === "cursor");
  if (needsClaudeHook) {
    const claudeHookPath = ".claude/hooks/verify.sh";
    writeFileSafe(join(dir, claudeHookPath), hookContent);
    chmodSync(join(dir, claudeHookPath), 0o755);
    files.push(claudeHookPath);
  }
  ```
  Critically, `.claude/hooks/verify.sh` is written **once**, not once per matching agent — the old code already had this property by accident (single boolean condition); the new code must preserve it explicitly with `.some()` rather than looping and re-writing (harmless functionally since content is identical and idempotent, but would duplicate the entry in the returned `files` list, breaking the "files created" note and any test asserting exact list length/uniqueness).
- Everything after (`goal.md`, `budget.yaml`, `ltf.config.yaml`, `state.md`, `.gitignore`) is agent-agnostic already and needs **zero changes** — this is the part of the design that makes "same goal, same budget, same verification command across agents" free: those files were never agent-specific to begin with.

### 3.5 `src/generators/claude-md.ts`, `codex-md.ts`, `gemini-md.ts`
- **No changes.** Each already accepts `templateInstructions?: string | null` and degrades gracefully when it's `null` (verified: `codex-md.ts:6` and `gemini-md.ts:6` both do `templateInstructions ? ... : ""`; `claude-md.ts:49-51` does `if (templateInstructions) sections.push(...)`). This is exactly the fallback behavior needed for §2.6 below (template missing per-agent instructions for one of the selected agents) — it already works, per-agent, with zero code change, because the lookup happens once per agent in the new `generateAgentConfigs` loop.

### 3.6 "Files created" output (`src/cli/init.ts`, `runGeneration`)
No structural change to the `p.note(...)` call (`src/cli/init.ts:258-261`) — it already just joins whatever `files` array `generateAll` returns. The change is entirely in what that array contains (§3.4) and in the outro line. See §5 for exact rendered output.

### 3.7 `src/cli/score.ts`
Rebalance the "Agent config" line item from a single 15-point OR-check into a base check + a multi-agent bonus, keeping the total pool at 100:

```ts
const agentConfigFiles = [
  ["CLAUDE.md", "claude-code"],
  ["AGENTS.md", "codex"],
  ["GEMINI.md", "gemini"],
  [".cursorrules", "cursor"],
] as const;
const presentAgentConfigs = agentConfigFiles.filter(([f]) => fileExists(join(dir, f)));

check(
  "Agent config (CLAUDE.md/AGENTS.md/GEMINI.md/.cursorrules)",
  10,                                   // was 15
  presentAgentConfigs.length > 0,
);

check(
  "Multi-agent parity (2+ agent configs present)",
  5,                                    // new
  presentAgentConfigs.length >= 2,
);
```
This keeps `15 = 10 + 5`, so the max achievable score is still 100 and every existing non-agent check is untouched. A single-agent project now tops out at 95/100 instead of 100/100 unless it adds a second agent config — this is an intentional scoring-semantics change (rewards teams that give every contributor's tool consistent instructions), not a type/API break. See §7 and the Open Questions in §8 for the alternative ("Option B") considered and rejected.
- `evaluateReadiness()` is currently unexported (`src/cli/score.ts:76`) and untested directly (only via the E2E script). Recommend exporting it so the new branch can get a direct unit test (§6) instead of relying solely on shell-script assertions.

---

## 4. Wizard UX

### 4.1 `@clack/prompts` primitive

Confirmed via `node_modules/@clack/prompts/dist/index.d.ts`: the package exports both `multiselect` and `groupMultiselect`. `multiselect` is the right primitive here — it renders a checkbox list, supports `initialValues` (array) and `required` (boolean), and returns either an array of selected values or the cancel symbol, exactly like `select` does today (`p.isCancel(...)` works identically).

### 4.2 Replacing the "Which agent?" question

The literal ASCII mockup in `ideas/04-kit.md:72-77` uses single-select bullet glyphs (`●`/`○`), which is Clack's `select` rendering, not `multiselect` (which renders `◼`/`◻`-style checkboxes). The mockup is aspirational shorthand, not a literal spec of the widget — a single-select list physically cannot represent "pick more than one." The plan deviates from the literal glyphs but preserves the intent (one-keystroke "All" shortcut, per-agent granularity) using Clack's actual multiselect widget:

```ts
const defaultAgents: AgentType[] =
  detection.agents.length > 0 ? detection.agents : ["claude-code"];

const agentChoice = (await p.multiselect({
  message: "Which agent(s)?",
  initialValues: defaultAgents,
  required: true,
  options: [
    { value: "claude-code" as const, label: "Claude Code" },
    { value: "codex" as const, label: "Codex CLI" },
    { value: "gemini" as const, label: "Gemini CLI" },
    { value: "cursor" as const, label: "Cursor" },
    { value: "all" as const, label: "All (multi-agent)" },
  ],
})) as (AgentType | "all")[] | symbol;

if (p.isCancel(agentChoice)) return null;

const agents: AgentType[] = agentChoice.includes("all")
  ? ["claude-code", "codex", "gemini", "cursor"]
  : CANONICAL_AGENT_ORDER.filter((a) => (agentChoice as AgentType[]).includes(a));
```

Rendered terminal output (space toggles a checkbox, enter confirms; `x` = checked):

```
◆  Which agent(s)?
│  [x] Claude Code
│  [ ] Codex CLI
│  [ ] Gemini CLI
│  [ ] Cursor
│  [ ] All (multi-agent)
└
```

If the user toggles "All (multi-agent)" instead of (or in addition to) individual boxes, the code above expands it to the full set regardless of what else is checked — so `["all", "codex"]` and `["all"]` are equivalent, and `["claude-code", "codex"]` (no "all") stays a 2-agent subset. `required: true` prevents submitting zero agents (Clack shows a validation message and blocks Enter).

`initialValues` defaults to whatever `detectAgent()` (`src/detectors/agent.ts`) already found installed/configured in the target directory — unchanged detection logic, just passed as a list instead of picking `detection.agents[0]`.

### 4.3 Non-interactive parity

`--yes` and `--template` never render this prompt (unchanged from today) — they go through `buildDefaults()` / the template branch in §3.3, which now array-wrap the same single-detected-agent default. `--agent` (any mode) bypasses this prompt entirely per §3.3.

---

## 5. Example Output

`kit init --yes --agent all` run against a project with `package.json` (vitest), `tsconfig.json`:

```
$ npx @loop-eng/kit init --yes --agent all

✓ Generated loop configuration

Files created
  ✓ CLAUDE.md
  ✓ AGENTS.md
  ✓ GEMINI.md
  ✓ .cursorrules
  ✓ .loop/verify.sh
  ✓ .claude/hooks/verify.sh
  ✓ .loop/goal.md
  ✓ .loop/budget.yaml
  ✓ .loop/ltf.config.yaml
  ✓ .loop/state.md

└  Run claude / codex / gemini / cursor to start your loop
```

Resulting file tree:

```
project/
├── CLAUDE.md              # generateClaudeMd(...)
├── AGENTS.md               # generateCodexMd(...)
├── GEMINI.md                # generateGeminiMd(...)
├── .cursorrules              # generateClaudeMd(...) — same content as CLAUDE.md
├── .claude/
│   └── hooks/
│       └── verify.sh      # written once, shared by claude-code + cursor
├── .loop/
│   ├── verify.sh           # canonical, agent-agnostic entry point
│   ├── goal.md             # identical goal text embedded in all 4 config files above
│   ├── state.md
│   ├── budget.yaml          # one shared verification command / budget for the whole team
│   └── ltf.config.yaml
└── .gitignore
```

All four agent files embed the same `task`, the same resolved `verifyCommand`, and (if `--template` was also passed) the same `goal`/`verification`/`budget` from the template — only the per-agent `agent_instructions` block and surrounding prose format differ. This is the "same goal, budget, and verification command" guarantee the task asked for, and it falls out of the existing architecture for free (§3.4) rather than requiring new synchronization logic.

`kit init --yes --agent claude-code,codex` (2 of 4) on the same project produces only `CLAUDE.md`, `AGENTS.md`, `.loop/verify.sh`, `.claude/hooks/verify.sh` (still generated, since `claude-code` is selected), and the usual `.loop/*` files — no `GEMINI.md`, no `.cursorrules`.

---

## 6. Testing Strategy

### 6.1 New unit tests

**`src/cli/__tests__/parse-agents.test.ts`** (new file, new `src/cli/__tests__/` dir if it doesn't exist yet — currently `cli/` has no test dir; `detectors/`, `generators/`, `templates/`, `utils/` do):
- `parseAgentFlag("claude-code")` → `["claude-code"]`
- `parseAgentFlag("all")` → all 4, canonical order
- `parseAgentFlag("codex,claude-code")` → `["claude-code", "codex"]` (canonical order, not input order)
- `parseAgentFlag("CLAUDE-CODE, Codex ")` → `["claude-code", "codex"]` (case/whitespace)
- `parseAgentFlag("claude-code,claude-code")` → `["claude-code"]` (dedup)
- `parseAgentFlag("all,codex")` → all 4 (`all` dominates)
- `parseAgentFlag("bogus")` → throws `InvalidAgentError` with message listing valid agents
- `parseAgentFlag("")` → throws `InvalidAgentError`
- `parseAgentFlag(" , ")` → throws `InvalidAgentError` (all tokens empty after trim)

**`src/generators/__tests__/generators.test.ts`** (extend existing file, whose `defaults` fixture at lines 12-18 and per-test overrides at lines 60/74 must be mechanically updated from `agent: "claude-code"` → `agents: ["claude-code"]` etc. as part of this change — see §7 for the exact 3 lines):
- "generates CLAUDE.md and AGENTS.md when agents is `[claude-code, codex]`" — assert `files` contains both paths, neither `GEMINI.md` nor `.cursorrules`.
- "generates all 4 agent files when agents is `[claude-code, codex, gemini, cursor]`" — assert all 4 paths present exactly once each.
- "writes `.claude/hooks/verify.sh` exactly once when both claude-code and cursor are selected" — assert `files.filter(f => f === ".claude/hooks/verify.sh").length === 1`.
- "does not write `.claude/hooks/verify.sh` when agents is `[codex, gemini]`" — assert path absent from `files` and `existsSync` false on disk.
- "all agent files share the same task text and verify command" — generate with `agents: ["claude-code","codex","gemini","cursor"]`, read all 4 files, assert each contains both the task string and the resolved verify command.
- "falls back to generic instructions for an agent missing from `agent_instructions`" — construct a `Template` fixture whose `agent_instructions` only has `claude-code`, request `agents: ["claude-code", "gemini"]`, assert `GEMINI.md` is generated successfully (no crash) and simply omits the template-specific section (content still has the generic "## Protocol" section).
- "output order is canonical regardless of selection order" — pass `agents: ["cursor", "claude-code"]` (reverse of canonical), assert `files` lists `CLAUDE.md` before `.cursorrules`.

**`src/cli/__tests__/score.test.ts`** (new — requires exporting `evaluateReadiness` from `score.ts` per §3.7):
- single agent config present (only `CLAUDE.md`) → "Agent config" check passes at 10/10, "Multi-agent parity" fails at 0/5.
- two agent configs present (`CLAUDE.md` + `AGENTS.md`) → both checks pass, 15/15 combined (same total as the old single check, by construction).
- zero agent configs → both checks fail, 0/15.

### 6.2 New E2E tests (`demo/test_e2e.sh`)

Add as a new numbered section after the existing "7. Score command" block (current file has 11 numbered sections / 43 `assert_*` calls total — the task description's "39" appears to be stale; confirm exact count against `main` before citing it externally):

```bash
# ─── Test 12: Multi-agent init (--agent all) ───
echo -e "${BOLD}12. Multi-agent init (--agent all)${RESET}"
T12_DIR="$DEMO_DIR/t12"
mkdir -p "$T12_DIR"
echo '{"name":"t12","scripts":{"test":"vitest run"}}' > "$T12_DIR/package.json"
echo '{}' > "$T12_DIR/tsconfig.json"

assert_pass "kit init --yes --agent all runs" kit init --yes --agent all --dir "$T12_DIR"
assert_file "CLAUDE.md created" "$T12_DIR/CLAUDE.md"
assert_file "AGENTS.md created" "$T12_DIR/AGENTS.md"
assert_file "GEMINI.md created" "$T12_DIR/GEMINI.md"
assert_file ".cursorrules created" "$T12_DIR/.cursorrules"
assert_file "claude hooks verify.sh created" "$T12_DIR/.claude/hooks/verify.sh"
assert_contains "AGENTS.md has same verify command as CLAUDE.md" "$T12_DIR/AGENTS.md" "vitest run"
assert_contains "GEMINI.md has same verify command as CLAUDE.md" "$T12_DIR/GEMINI.md" "vitest run"
echo ""

# ─── Test 13: Multi-agent init (comma list subset) ───
echo -e "${BOLD}13. Multi-agent init (comma list)${RESET}"
T13_DIR="$DEMO_DIR/t13"
mkdir -p "$T13_DIR"
echo '{"name":"t13"}' > "$T13_DIR/package.json"

assert_pass "kit init --yes --agent claude-code,codex runs" kit init --yes --agent claude-code,codex --dir "$T13_DIR"
assert_file "CLAUDE.md created" "$T13_DIR/CLAUDE.md"
assert_file "AGENTS.md created" "$T13_DIR/AGENTS.md"
if [ -f "$T13_DIR/GEMINI.md" ]; then
  echo -e "  ${RED}✗${RESET} GEMINI.md should not exist"; FAIL=$((FAIL + 1))
else
  echo -e "  ${GREEN}✓${RESET} GEMINI.md correctly absent"; PASS=$((PASS + 1))
fi
echo ""

# ─── Test 14: Invalid --agent value ───
echo -e "${BOLD}14. Invalid --agent value${RESET}"
T14_DIR="$DEMO_DIR/t14"
mkdir -p "$T14_DIR"
assert_output_contains "unknown agent shows error" "Unknown agent" kit init --yes --agent bogus --dir "$T14_DIR"
echo ""

# ─── Test 15: Score reflects multi-agent parity ───
echo -e "${BOLD}15. Score command shows multi-agent parity${RESET}"
assert_output_contains "score shows multi-agent parity check" "Multi-agent parity" kit score --dir "$T12_DIR"
echo ""
```

Also add one template-composition E2E case: `kit init --template fix-types --agent all --dir <dir>` asserting all 4 agent files exist and each embeds the template's `agent_instructions` text where available (`tsc --noEmit` line) and degrades gracefully for any agent the template doesn't define instructions for (today's `fix-types.yaml` defines `claude-code`, `codex`, `gemini` but not `cursor` — this is the real, already-existing case referenced in §2.6, not a hypothetical).

### 6.3 What does *not* need new tests
- `claude-md.ts` / `codex-md.ts` / `gemini-md.ts` unit tests, if any exist beyond what's in `generators.test.ts`, need no changes — their signatures are untouched (§3.5).
- `detectors/agent.test.ts` — `detectAgent()` already returns `AgentType[]`; untouched.
- `templates/registry.test.ts` — template loading/validation untouched; `agent_instructions` was already `Record<string, string>` and is read per-agent now instead of once, but the registry doesn't know or care how many times it's read.

---

## 7. Backward Compatibility

**Compiles-but-behaves-the-same paths:**
- `kit init` (interactive, no `--agent`), `kit init --yes` (no `--agent`), `kit init --template X` (no `--agent`) all continue to produce exactly one agent's config file, chosen exactly as today (first detected agent, or `claude-code`). The only observable difference is the wizard screen (`select` → `multiselect`, §4.2) when running fully interactively without `--agent`.
- `.loop/goal.md`, `.loop/budget.yaml`, `.loop/ltf.config.yaml`, `.loop/state.md`, `.gitignore` generation is byte-for-byte unchanged (§3.4) — none of that code path branches on agent count.
- The verify-hook duplication rule ("claude-code or cursor gets `.claude/hooks/verify.sh` too") is preserved exactly for the single-agent case; it's generalized to `.some()` over the array for the multi-agent case (§3.4).

**Mechanical (compile-time-forced) test updates required — not behavior changes:**
- `src/generators/__tests__/generators.test.ts:16` — `agent: "claude-code"` → `agents: ["claude-code"]` in the shared `defaults` fixture.
- `src/generators/__tests__/generators.test.ts:60` — `agent: "codex"` → `agents: ["codex"]`.
- `src/generators/__tests__/generators.test.ts:74` — `agent: "gemini"` → `agents: ["gemini"]`.
- These are the only three lines in the existing 64-unit-test suite that construct a `WizardAnswers` literal; every other test either doesn't touch `WizardAnswers` or spreads `defaults` without overriding `agent`. Confirmed by reading the full file (`src/generators/__tests__/generators.test.ts`) — no other file in `src/**/__tests__/` imports `WizardAnswers`.
- All 8 tests in that file keep passing once the fixture compiles, since `generateAgentConfigs` with a 1-element array behaves identically to the old `generateAgentConfig` for that element.

**E2E (`demo/test_e2e.sh`):**
- All existing sections (1-11, 43 `assert_*` calls as currently written — confirmed via `grep -c '^assert_'`) invoke `kit init` with no `--agent` flag, so they exercise only the single-agent path and are unaffected. New sections 12-15 are purely additive.

**Breaking (by design, documented, version-bumped):**
- `WizardAnswers.agent: AgentType` → `WizardAnswers.agents: AgentType[]` is a breaking change to the package's public TypeScript API (re-exported from `src/index.ts:3-11`). Any external code doing `import type { WizardAnswers } from "@loop-eng/kit"` and constructing/reading `.agent` will fail to compile. Recommend: bump to **0.2.0**, one-line CHANGELOG entry, no runtime deprecation shim (pre-1.0, low external adoption risk, shim adds permanent complexity for a field that's part of an internal wizard flow, not a stable data format).
- `kit score` output: single-agent projects that previously scored 100/100 with agent config fully satisfied now cap at 95/100 unless they add a second agent config (§3.7). No test currently asserts an exact numeric score (`assert_output_contains ... "/100"` only checks the string appears), so no existing test breaks, but this is a real, visible behavior change for any user who has `kit score` output committed to a README or CI gate checking for `== 100`. Worth a CHANGELOG line.

---

## 8. Effort Estimate and Open Questions

### 8.1 Effort estimate

Most of what the original `ideas/04-kit.md` Phase 2 scope described (Codex/Gemini generators, template browser, 6 more templates, LTF config, `kit score`) is **already built** in the current codebase — this plan covers only the remaining multi-agent-selection gap.

| Task | Est. |
|---|---|
| `types.ts` rename + `parse-agents.ts` new file | 0.25 day |
| `init.ts`: flag, wizard multiselect, `buildDefaults`, `getStartHints`, template branch | 0.5 day |
| `generators/index.ts`: `generateAgentConfigs`, hook dedup, canonical order | 0.5 day |
| `score.ts`: rebalance + export `evaluateReadiness` | 0.25 day |
| Unit tests (parse-agents, generators additions, score) | 0.5 day |
| E2E tests (sections 12-15 + template-composition case) | 0.25 day |
| README / CLI `--help` text / CHANGELOG update | 0.25 day |
| Manual review buffer | 0.25 day |
| **Total** | **~2.75 days** |

### 8.2 Open questions (need a decision before coding starts)

1. **Real hook wiring for Codex/Gemini.** Web research (July 2026) confirms both Codex CLI and Gemini CLI now ship genuine hook engines — Codex via `config.toml` with named lifecycle hooks (stable since a v0.124.x-era release, with an in-TUI `/hooks` browser), Gemini CLI via `.gemini/settings.json` with JSON-schema lifecycle events (`SessionStart`, `BeforeTool`, `AfterAgent`, etc., shipped January 2026). Neither uses a "drop a script at a conventional path" model the way Kit's own `.claude/hooks/verify.sh` convention assumes (and note: even that convention is a Kit-invented convenience path referenced in prose inside CLAUDE.md, not literally auto-discovered by Claude Code itself — see `FINDINGS.md:114`, which already flagged "Codex/Gemini/Cursor don't have standardized hook paths" as a known, accepted gap). **Recommendation: do not attempt real hook-engine wiring in this phase.** Generating a valid `config.toml` hook entry or `.gemini/settings.json` hook block per agent is a materially different, per-tool-schema feature and belongs in its own future phase. This plan's scope stays at "generate consistent instruction files that reference `.loop/verify.sh` as the one command to run," which all three tools' plain-instruction-file mechanism (AGENTS.md / GEMINI.md / CLAUDE.md) already supports without any tool-specific schema.
2. **Gemini CLI's own status.** The same research turned up reporting that Gemini CLI's free/Pro/Ultra tiers were discontinued June 18, 2026 in favor of "Google Antigravity CLI" (`agy`), with only Code Assist Standard/Enterprise continuing on a stable channel. This is recent and not fully corroborated by primary sources in this pass. **Recommendation:** keep the `gemini` `AgentType` and `GEMINI.md` generator as-is for now (Enterprise users persist; the file format itself doesn't disappear), but flag a follow-up research spike on whether Kit should add an `antigravity` `AgentType` in a later phase. Not a blocker for this phase.
3. **Score rebalancing weight.** §3.7 proposes splitting the existing 15-point "Agent config" line into 10 (base) + 5 (multi-agent bonus). Alternative ("Option B") considered: leave the base check at 15 and add the multi-agent bonus as pure upside on top, pushing the achievable max above 100 unless every other line item is also renormalized. Rejected because a 0-100 score whose max isn't reliably 100 undermines the "score" mental model, but this is a product/UX call, not a technical constraint — confirm the 10/5 split (or an alternative split) before implementing.
4. **Strictness of `--agent` validation.** Plan recommends hard failure (exit 1) on any unrecognized token, matching existing `--template` not-found behavior (`src/cli/init.ts:56-61`). Alternative: warn and proceed with only the valid tokens. Recommend keeping strict — silent partial application of a multi-value flag is a worse failure mode than a clear error.
5. **Cursor's actual hooks/rules directory convention** is unconfirmed in this research pass (no authoritative doc reviewed). Worth a dedicated lookup before any future phase that wires real per-tool hooks (see item 1) — not a blocker here since this phase makes no Cursor-specific hook changes beyond the existing `.claude/hooks/verify.sh` sharing.
6. **Should `.cursorrules` get Cursor-specific framing** instead of being byte-identical to `CLAUDE.md` when both are selected? Recommend keeping them identical for this phase (matches current single-agent behavior exactly, zero new generator code) and revisiting only if user feedback specifically asks for Cursor-flavored instructions.
