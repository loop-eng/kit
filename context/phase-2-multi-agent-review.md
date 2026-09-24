# Phase 2 Adversarial Review: Multi-Agent Selection ("All")

**Scope:** Independent verification/risk review of adding `AgentType[]` multi-select
("All (multi-agent)") to the `kit init` wizard, per the mockup in
`ideas/04-kit.md` (lines 72-93). This document does not propose an
implementation — it is a pre-mortem intended to catch design flaws before code
is written. It was produced by reading the current source tree directly
(`src/cli/init.ts`, `src/types.ts`, `src/generators/index.ts`,
`src/generators/{claude-md,codex-md,gemini-md}.ts`, `src/cli/score.ts`,
`src/generators/__tests__/generators.test.ts`, `demo/test_e2e.sh`, all 6
`templates/*.yaml` files, `src/detectors/agent.ts`, `src/utils/fs.ts`,
`src/generators/hooks.ts`, and `FINDINGS.md`) plus external research on Codex
CLI and Gemini CLI hook conventions.

---

## 1. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | Multi-agent overwrite silently clobbers 4 hand-written config files (CLAUDE.md, AGENTS.md, GEMINI.md, .cursorrules) instead of 1, with no additional warning vs. today's single-file overwrite. | High | High | Add a pre-write diff/confirmation step ("N existing agent config files will be overwritten: list them") gated on `!opts.yes`. This is a pre-existing gap (`writeFileSafe` always clobbers, `FINDINGS.md` #6 "ACCEPTED" as a design choice for the *single*-file case) but the blast radius multiplies 4x under "All," which changes the risk calculus enough to warrant revisiting the "ACCEPTED" verdict. |
| R2 | `kit score` semantics become ambiguous/inconsistent after a project is initialized with `--agent all` vs. a single agent, producing a confusing "score didn't change" or "score dropped" UX. | High | Medium | Adopt the semantics in Section 2 below: score should check for agent configs matching the *agents actually selected* during the most recent `init`, persisted in a new manifest (see Section 2), not a blind OR across all 4 possible files. |
| R3 | `getStartHint` / outro message becomes a wall of text or, worse, misleadingly suggests only one command when N agents were configured. | Medium | Medium | Explicit outro copy spec in Section 7 — one line per agent, capped, with a fallback "run any of" framing. |
| R4 | Verify-hook proliferation: naive per-agent hook paths (e.g. `.codex/hooks/verify.sh`, `.gemini/hooks/verify.sh`) are written as literal copies of the Claude-style bash script, but Codex CLI and Gemini CLI hooks are NOT bash-script-at-a-path systems — they require a `hooks.json` / `settings.json` registration with a JSON stdin/stdout contract, different event model, and (for Gemini) a strict "no stdout except final JSON" rule. See Section 4 finding below. | High (if naive path-copy approach is taken) | High (generates dead/misleading files, not just "drift risk") | Do NOT create per-agent hook directory copies. Keep the single shared `.loop/verify.sh` as source of truth; agent config files (CLAUDE.md/AGENTS.md/GEMINI.md/.cursorrules) should reference it by relative path in prose instructions, not attempt to wire native hook systems Kit does not support. |
| R5 | Template YAML `agent_instructions` map has **no `cursor` key in any of the 6 shipped templates**, and only `fix-types.yaml` has all of `claude-code`/`codex`/`gemini` — the other 5 templates (`add-tests`, `dependency-update`, `fix-lint`, `migrate-api`, `security-audit`) DO have all three non-cursor keys (confirmed by direct grep), so cursor is uniquely degraded across all 6 templates today. Multi-agent selection makes this pre-existing gap visible simultaneously across 4 files in one run instead of being hidden behind a single agent choice. | High (pre-existing, will surface loudly under "All") | Medium | Either (a) add a `cursor` key to all 6 templates before or alongside Phase 2, or (b) make `.cursorrules` reuse the `claude-code` instructions as an explicit, intentional fallback (not a silent `null`) and document this in the generator. Recommendation: (b) short-term, (a) as a tracked follow-up — see Section 3. |
| R6 | Naive `AgentType -> AgentType[]` type change breaks `answers.agent === "claude-code"`-style equality checks scattered across `init.ts`, `generators/index.ts`, and tests, producing type errors or silent logic bugs (e.g., `getStartHint(answers.agent)` no longer compiles, or a switch statement silently falls through). | High | High | Full regression checklist in Section 4 (renumbered as Section 4 in doc — see "Regression checklist" section below). |
| R7 | `detectAll(...).agents` (plural, already an array in `DetectionResult`) collides semantically with the new `WizardAnswers.agents` (also plural) — easy to confuse "agents installed on this machine" with "agents the user chose to generate for." Naming collision risk during implementation. | Medium | Low | Recommend distinct field names: keep `DetectionResult.agents: AgentType[]` (detected) and use `WizardAnswers.agents: AgentType[]` (selected) but require the implementer to never do `detection.agents === answers.agents` type comparisons; add a code comment at both declarations cross-referencing the other. |
| R8 | `.claude/hooks/verify.sh` is currently written for **both** `claude-code` AND `cursor` (see `generators/index.ts` line 41: `if (answers.agent === "claude-code" || answers.agent === "cursor")`), which is already a quirk — cursor has no relationship to the `.claude/` directory convention. Multi-agent will inherit and possibly compound this: does "All" write `.claude/hooks/verify.sh` once (correct, shared) or does someone "fix" this during refactor to write it once per agent path (wrong, see R4)? | Medium | Medium | Explicitly preserve current behavior: `.claude/hooks/verify.sh` is written if `claude-code` OR `cursor` is in the selected set, written exactly once regardless of how many of those two are selected. Treat this as intentional (Cursor has historically shared Claude Code's hook convention in some setups) rather than something to "fix" during the multi-agent refactor — a refactor here is scope creep for Phase 2 and its own regression risk. |
| R9 | `--template <name>` non-interactive path (`opts.template` branch in `init.ts`) and `--yes` path (`buildDefaults`) both currently hardcode single-agent selection logic (`detection.agents.length > 0 ? detection.agents[0] : "claude-code"`). If multi-agent is added only to the interactive wizard branch, these two non-interactive paths silently retain single-agent behavior — an inconsistency between interactive and scripted usage that may not be caught by manual testing (which tends to exercise the interactive wizard). | Medium | Medium | Explicitly decide and document: do `--template` and `--yes` support `--agent all` / `--agent claude-code,codex`? If not in Phase 2 scope, document the gap in the CLI help text and README, and add a test asserting single-agent behavior is preserved for both non-interactive paths (a "did not regress" test, not a "supports multi" test). |
| R10 | Idempotency/re-run test (E2E Test 10, `demo/test_e2e.sh` line 182) only asserts "re-running init --yes succeeds" (exit code), not file content stability. Under multi-agent, re-running with a *different* agent subset than the prior run (e.g., first run `claude-code` only, second run `all`) is untested territory — does it add the missing 3 files, or does something break because `.loop/state.md`'s "only write if not exists" guard (line 68 of `generators/index.ts`) interacts oddly with a changed agent set? | Medium | Low | Add an explicit "incremental re-run" test case (see Test Matrix, Section 6, TM-6). |

---

## 2. Score Semantics Recommendation

### The problem, stated precisely

`evaluateReadiness` in `src/cli/score.ts` (lines 88-95) currently awards full
15 points for "Agent config" if **any one** of CLAUDE.md / AGENTS.md /
GEMINI.md / .cursorrules exists. This is an OR-across-all-possible-files
check with no memory of *which* agent(s) the user actually asked for.

Once multi-agent selection exists, three interpretations become possible:

- **(A) Keep OR semantics unchanged.** A project scaffolded for "All" and a
  project scaffolded for a single agent score identically (15/15) on this
  line. This under-rewards multi-agent setups that did strictly more work,
  and gives no signal if 3 of 4 files are later deleted.
- **(B) Require ALL 4 files unconditionally.** A single-agent project (still
  the common case, and arguably the *default* recommended flow — Phase 1's
  pitch doc frames "5 questions" as fast, not "generate everything for every
  agent by default") would now score fewer than 15/15 on a check it used to
  pass fully, with no code change on the user's part. This is a silent
  regression: someone re-running `kit score` after upgrading Kit sees a
  score drop for a project they didn't touch.
- **(C) Score against the agent set that was actually selected**, recorded
  at `init` time.

### Recommendation: (C), with a persisted manifest, degrading gracefully to (A) when no manifest exists

1. **Persist the selected agent set.** `.loop/budget.yaml` (or a new small
   `.loop/kit.json` — recommend the latter to avoid overloading the budget
   schema, which is a stable, already-tested public artifact per
   `generators/__tests__/generators.test.ts`) should record which agents
   were selected at the most recent `init`, e.g. `{"agents": ["claude-code",
   "codex"]}`. This is new state; it doesn't exist today.
2. **`kit score` reads that manifest if present** and checks: "of the agents
   recorded, are all their corresponding config files present?" Partial
   credit is possible: e.g. 2 of 2 recorded agents present = full 15 points;
   1 of 2 = 7-8 points (partial); 0 of 2 = 0. This rewards completeness
   relative to *stated intent*, not an arbitrary global maximum.
3. **If no manifest exists** (e.g., hand-rolled project, or a project
   scaffolded by a pre-Phase-2 version of Kit that never wrote one), **fall
   back to today's OR-across-all-4-files logic** (interpretation A). This
   preserves backward compatibility for every existing scaffolded project
   and is a strict superset of current behavior — no existing project's
   score changes.
4. Do NOT adopt (B). It fails the "don't break existing users" test and
   punishes the common single-agent case, which the pitch doc's own
   90-second demo (`ideas/04-kit.md` line 92, single `Run \`claude ...\``
   outro) treats as the primary path, not the exception.

### Why this matters for the "score dropped" UX complaint anticipated in the task

Under (C) with fallback, the scenario in the prompt — "a user ran `kit init`
with a single agent, then a teammate runs `kit init --agent all`" — now has
a clean, explainable story: the manifest is overwritten by the second `init`
to record all 4 agents, and the score legitimately reflects that the project
now claims to support 4 agents' worth of config, which is either fully
earned (if all 4 files exist, which they will immediately after the second
`init`) or a fair partial score if some are later deleted. Nothing about
this is surprising if `kit score`'s output line is reworded from "Agent
config (CLAUDE.md/AGENTS.md/GEMINI.md)" to something that names the
*recorded* agent set, e.g. "Agent config (2/2 selected: claude-code,
codex)" — see Section 7.

---

## 3. Template Compatibility Findings

Confirmed by direct inspection of all 6 files in `templates/`:

| Template | `claude-code` key | `codex` key | `gemini` key | `cursor` key |
|---|---|---|---|---|
| `add-tests.yaml` | yes | yes | yes | **no** |
| `dependency-update.yaml` | yes | yes | yes | **no** |
| `fix-lint.yaml` | yes | yes | yes | **no** |
| `fix-types.yaml` | yes | yes | yes | **no** |
| `migrate-api.yaml` | yes | yes | yes | **no** |
| `security-audit.yaml` | yes | yes | yes | **no** |

**Finding: this is a pre-existing gap, not a new one introduced by
multi-agent.** Today, a user who selects Cursor as their single agent and
`--template fix-types` already gets a `.cursorrules` file generated via
`generateClaudeMd(...)` (per `generators/index.ts` line 99-103, which routes
`cursor` through the same generator function as `claude-code`) but with
`templateInstructions` resolved as `null` (`template?.agent_instructions?.
["cursor"]` — no such key exists in any template), because the lookup in
`generateAgentConfig` (line 81) keys directly off `answers.agent`, and
`"cursor"` never matches any YAML key. The generated `.cursorrules` is
missing its entire "## Loop Instructions" section — it still has Goal,
Verification Gate, Loop Protocol, Additional Checks, Project Context, and
Constraints (since those come from the generator's own template literals,
not the YAML), but loses the template-specific tactical guidance ("run tsc
--noEmit," "fix one file at a time," etc.) that claude-code/codex/gemini
users get.

**Why multi-agent makes this worse, not just "equally bad":** today this
gap only surfaces if a user *specifically chooses* Cursor. Under "All," every
multi-agent user hits it on every templated run — the degraded `.cursorrules`
becomes the default experience for 25% of generated files whenever a
built-in template is used, which is likely to be the common path (6 curated
templates are a headline feature per `ideas/04-kit.md` line 45).

**Recommendation:** Two valid options, pick one explicitly before shipping
Phase 2 — do not leave this to accidental behavior:

- **(a) Minimal, no YAML changes:** In `generateAgentConfig`, when looking
  up `template?.agent_instructions?.[answers.agent]` for `cursor`,
  explicitly fall back to the `claude-code` key
  (`template?.agent_instructions?.["cursor"] ?? template?.agent_instructions?.
  ["claude-code"] ?? null`). This is a one-line, low-risk change, requires no
  edits to the 6 template files, and is defensible because `.cursorrules`
  already reuses the Claude-style generator (`generateClaudeMd`) — reusing
  its instructions too is consistent, not a hack.
- **(b) Correct, higher-cost:** Add an explicit `cursor:` key to all 6
  template YAMLs (touches 6 files, needs new copy for each, needs the 6
  existing generator tests + E2E assertions to be extended to check for
  cursor-specific content, not just presence of `.cursorrules`).

**This review's recommendation is (a) for Phase 2**, with (b) filed as a
tracked backlog item — it's a content/copywriting task, not an
architecture task, and doesn't block multi-agent shipping. Ship (a) so
Cursor never silently gets a *worse* experience than it has today; treat
(b) as quality polish.

---

## 4. Regression Checklist

### Unit tests — `src/generators/__tests__/generators.test.ts`

All 8 existing tests use `answers.agent: "claude-code"` (or an override to a
single other value) as a plain string field on a `WizardAnswers` object literal.
If `WizardAnswers.agent: AgentType` becomes `WizardAnswers.agents: AgentType[]`
(rename, not just widen — a widen-only approach like `agent: AgentType |
AgentType[]` is explicitly NOT recommended, see Open Questions), **every one
of these 8 tests fails to compile**, because:

- Line 16: `agent: "claude-code"` in the shared `defaults` object — must
  become `agents: ["claude-code"]`.
- Line 60: `{ ...defaults, agent: "codex" }` — must become `{ ...defaults,
  agents: ["codex"] }`.
- Line 74: `{ ...defaults, agent: "gemini" }` — same pattern.
- Lines 41-55, 57-69, 71-82, 84-100, 102-116, 118-134, 136-149, 151-164: all
  8 test bodies reference `defaults` (which embeds the field), so all 8 are
  at risk even where the override isn't agent-specific (e.g., the
  budget/build-passes/unlimited tests at lines 102, 118, 136, 151 don't
  override `agent` but still construct `answers` from `defaults`, which
  must compile under the new shape).

Additionally, three **new** assertions are needed, not just fixes to old
ones:
- A test that passes `agents: ["claude-code", "codex", "gemini", "cursor"]`
  and asserts all 4 config files + the shared `.loop/verify.sh` + exactly
  one `.claude/hooks/verify.sh` (not accidentally duplicated logic writing
  it twice because both `claude-code` and `cursor` are present — see R8) are
  produced, with no crash.
- A test asserting `files` return value (the `string[]` used to build the
  "Files created" note in `init.ts`) has no duplicate entries when multiple
  agents map to overlapping side-effect paths (again, the `.claude/hooks/
  verify.sh` shared-by-two-agents case).
- A test for the cursor template-instructions fallback decided in Section 3.

### `src/cli/init.ts` internals (not currently unit-tested directly, but load-bearing)

- `getStartHint(agent: AgentType): string` (lines 267-278) — signature must
  change to accept `AgentType[]` and return either a `string` (joined) or
  `string[]` (caller joins). Its exhaustive `switch` with no `default` case
  relies on TypeScript's exhaustiveness checking over the single-value
  union; that guarantee is lost once the input is an array and must be
  re-established via `.map()` over the array plus the same switch per
  element, or the exhaustiveness check silently stops protecting future
  `AgentType` additions.
- `buildDefaults()` (lines 201-213) and the `opts.template` branch (lines
  62-68) both construct `WizardAnswers` with a single-value `agent` field
  hardcoded from `detection.agents[0]`. These must be updated in lockstep
  with the type change or they won't compile — see R9 for the *semantic*
  question of whether they should support multi-select at all in Phase 2.
- `runWizard`'s agent question (lines 166-178) uses `p.select` (single
  choice). Must become `p.multiselect` (Clack's multi-select prompt) or a
  single `p.select` with a synthetic `"all"` option that expands to all 4
  `AgentType` values downstream. These have different UX and different
  `p.isCancel` handling — worth flagging as an implementation-detail choice
  the other agent's plan should make explicitly (see Open Questions).

### `src/generators/index.ts`

- `generateAgentConfig` (lines 78-105) currently returns a single `{path,
  content}` pair via a `switch` on `answers.agent`. Under multi-agent this
  must become a loop/map producing N pairs — the function's return type and
  every call site changes shape, not just its input type.
- Line 41's `if (answers.agent === "claude-code" || answers.agent ===
  "cursor")` guard for `.claude/hooks/verify.sh` must become a `.some()` /
  `.includes()` check over the array, written exactly once regardless of
  how many qualifying agents are present (R8).

### `src/cli/score.ts`

- Line 91-94's OR-across-4-files check must be revisited per Section 2's
  recommendation — this is a required change, not optional, if the score
  semantics decision in Section 2 is adopted.

### `demo/test_e2e.sh`

- Test 1 (lines 89-108) only exercises `--yes` (single default agent) —
  unaffected unless `--yes` gains multi-agent support (see R9); if it does,
  this test's assertions (`assert_file "CLAUDE.md created"`) need a sibling
  test block for the multi-agent path.
- Test 7 (lines 160-165) checks `"Agent config"` appears in `kit score`
  output — if the score line's wording changes per Section 7's
  recommendation (e.g., to include the recorded agent count), this
  `assert_output_contains` pattern match (`"Agent config"`) still passes
  as a substring match, but a **new** E2E assertion should verify the
  updated wording contains the actual recorded agent names/counts, not
  just the unchanged label prefix.
- No existing E2E test exercises `--agent all` or any multi-value agent
  flag at all — this is pure net-new coverage, not a regression risk, but
  its absence should be called out as a gap in the "done" bar (Section 5).

### Non-test, but load-bearing documentation that will silently drift if untouched

- `README.md` line 56 already claims "Cross-agent support | Generates
  configs for Claude Code, Codex CLI, Gemini CLI, Cursor" — this line
  predates multi-agent and describes single-select cross-agent support.
  Confirm the Phase 2 PR updates this line's phrasing (e.g., "...for one or
  more of Claude Code, Codex CLI, Gemini CLI, Cursor") so it doesn't imply
  simultaneous generation was already the case.

---

## 5. Acceptance Criteria

Phase 2's multi-agent work is done when **all** of the following hold:

1. `WizardAnswers` supports selecting 1-to-4 agents in a single `init` run,
   and the wizard's "Which agent?" question offers a genuine multi-select
   (not just a 5th "All" option that silently means "all 4 hardcoded" with
   no way to pick e.g. "Claude Code + Codex only" — the mockup's literal
   "All (multi-agent)" wording under a single-select `p.select` list is
   itself a UX smell worth flagging, see Open Questions).
2. Selecting N agents generates exactly the N corresponding config files
   (CLAUDE.md / AGENTS.md / GEMINI.md / .cursorrules) plus the existing
   shared `.loop/*` files, with `.claude/hooks/verify.sh` written exactly
   once if claude-code and/or cursor is among the N (not zero times, not
   twice).
3. No native per-agent hook directories (`.codex/hooks/`, `.gemini/hooks/`)
   are created with bash-script copies that pose as functional hooks in
   systems that require JSON-based hook registration (R4). If Codex/Gemini
   native hook integration is desired, it is scoped as a separate,
   explicitly-named future phase — not bundled silently into "multi-agent
   support."
4. `kit score`'s "Agent config" check reflects the recommendation in Section
   2 (recorded-intent scoring with graceful fallback for pre-Phase-2
   projects), and a project scored before this change and re-scored after
   (with no file changes) produces an identical score.
5. The Cursor template-instructions gap (Section 3) has an explicit,
   intentional resolution merged (recommended: option (a), the fallback to
   `claude-code` instructions) — not left as an accidental `null`.
6. `getStartHint`-equivalent outro logic produces the UX specified in
   Section 7, verified by at least one test asserting the exact multi-agent
   outro string shape.
7. All 8 existing generator unit tests pass after being updated for the new
   `WizardAnswers` shape (not skipped, not deleted).
8. All 11 existing E2E test blocks in `demo/test_e2e.sh` still pass
   unmodified in their single-agent assertions (i.e., single-agent `kit
   init --yes` behavior is provably unchanged), plus new E2E coverage exists
   for at least one multi-agent run.
9. `--yes` and `--template` non-interactive flows have an explicit,
   documented decision on whether they support multi-agent in Phase 2 (R9)
   — "we decided not to" is an acceptable answer, "unspecified/whatever
   falls out of the refactor" is not.
10. `README.md` and `ideas/04-kit.md`-derived user-facing docs (if any ship
    separately) are updated to match actual multi-select UX, not the exact
    mockup wording if the implementation diverges from it (e.g., if a real
    multi-select checkbox UI is used instead of the mockup's single-select
    list with an "All" row).

---

## 6. Test Matrix

| ID | Input | Expected Output | Failure Mode Targeted |
|---|---|---|---|
| TM-1 | `agents: ["claude-code"]` (single, existing default) | Identical file set/content to current single-agent behavior; byte-for-byte same CLAUDE.md as before the refactor | Baseline regression guard — the refactor must be a strict superset |
| TM-2 | `agents: ["claude-code", "codex", "gemini", "cursor"]` (all 4) | 4 config files (CLAUDE.md, AGENTS.md, GEMINI.md, .cursorrules) + `.loop/verify.sh` + exactly ONE `.claude/hooks/verify.sh` + shared `.loop/{goal,budget,ltf.config,state}` files; `files` array has no duplicate paths | R4, R8, generateAgentConfig loop correctness |
| TM-3 | `agents: ["codex", "gemini"]` (2, neither claude-code nor cursor) | AGENTS.md + GEMINI.md only; NO `.claude/hooks/verify.sh` written at all | Guards against the hook-write condition firing incorrectly for non-claude/cursor sets |
| TM-4 | `agents: ["cursor"]` alone, WITH `--template fix-types` | `.cursorrules` generated; per Section 3 decision (a), contains the claude-code fallback "## Loop Instructions" content, not an empty/missing section | R5 / Section 3 fallback correctness |
| TM-5 | `agents: ["claude-code", "cursor"]` (both hook-eligible agents) | `.claude/hooks/verify.sh` written exactly once, not twice, and not with duplicated content appended | R8 |
| TM-6 | `init` run 1 with `agents: ["claude-code"]`, then `init` run 2 (same dir) with `agents: ["claude-code","codex","gemini","cursor"]` | Run 2 succeeds, adds AGENTS.md/GEMINI.md/.cursorrules without touching CLAUDE.md content incorrectly, `.loop/state.md` is NOT overwritten (existing "only if not exists" guard preserved), and does not crash | R10, idempotency under changing agent sets |
| TM-7 | Pre-existing hand-written `CLAUDE.md` with unrelated custom content (e.g., a README-style project overview, no loop markers) + `init` with `agents: ["claude-code","codex"]` in non-`--yes` mode | Either (per R1 mitigation) the CLI warns and lists CLAUDE.md as about to be overwritten before proceeding, or — if no such warning is implemented — this test documents and asserts the actual (undesirable) silent-overwrite behavior so it's a known, tracked gap rather than a surprise | R1 |
| TM-8 | `kit score` run on a project scaffolded by a **pre-Phase-2** Kit version (no agent-manifest file present, only e.g. CLAUDE.md exists on disk) | Score's "Agent config" line awards full credit via legacy OR-across-4-files fallback (Section 2, point 3) — score is unchanged from pre-Phase-2 behavior | Score backward-compatibility |
| TM-9 | `kit score` run on a project scaffolded with `agents: ["claude-code","codex"]` where AGENTS.md is later deleted by hand | Score's "Agent config" line reflects 1-of-2 recorded agents present (partial credit, e.g. 7-8 of 15), not full 15 and not 0 | Section 2 recorded-intent scoring, partial-credit correctness |
| TM-10 | `kit score` run twice with no file changes in between, before and after the Phase 2 score-logic change ships, on an untouched pre-existing single-agent project | Numerically identical score both times | Explicit "no silent score drift" regression guard called out in Section 2 |
| TM-11 | Outro message after `agents: ["claude-code","codex","gemini"]` (3 agents) | Outro string asserted against an exact expected format (see Section 7) — test should fail loudly if the format regresses to something verbose/unbounded | R3 |
| TM-12 | `p.isCancel` during a multi-select agent prompt (user hits Ctrl+C mid-selection) | Wizard exits with code 130 (per existing `FINDINGS.md` #25 convention), identical to today's single-select cancel behavior | Ensures multi-select doesn't regress the cancel-handling convention already fixed once |
| TM-13 | `--template fix-types --agent claude-code,codex` (or whatever the decided non-interactive multi-agent flag syntax is) if R9 is resolved as "yes, support it" | Both CLAUDE.md and AGENTS.md generated with template instructions; if R9 is resolved as "no, not in Phase 2," this test instead asserts the CLI errors clearly or documents single-agent-only behavior for this flag | R9 |

---

## 7. Recommended UX for Outro Message and Score Display

### Outro message

Current single-agent outro (`init.ts` line 264):
```
Run claude to start your loop
```

For N agents, avoid two failure modes: (a) silence/ambiguity about which
command applies to which file, (b) an unbounded wall of text if a 5th agent
type is ever added later.

**Recommendation:**

- 1 agent selected: keep exactly the current format (no change) — this is
  the common case and must not regress in verbosity.
- 2-4 agents selected: one line per agent, prefixed, capped implicitly by
  the fact there are only 4 possible `AgentType` values today:

```
Run one of the following to start your loop:
  claude   (uses CLAUDE.md)
  codex    (uses AGENTS.md)
  gemini   (uses GEMINI.md)
```

  This mirrors the existing `p.note(files.map(...).join("\n"), "Files
  created")` pattern already used for the file list (lines 258-261), so it's
  visually consistent with an established Clack idiom in this codebase
  rather than inventing a new one.

- Explicitly avoid a single run-on line like `Run claude, codex, or gemini to
  start your loop` — it reads fine at 2 agents, degrades badly at 4, and
  loses the file-association info the wizard just showed in "Files created."

### Score display

Change the "Agent config" line's label from the current static string
`"Agent config (CLAUDE.md/AGENTS.md/GEMINI.md)"` (score.ts line 89, note
this string is *already* stale — it omits `.cursorrules` from the label
despite checking for it in the OR condition on line 94) to a dynamic label
reflecting Section 2's recorded-intent model:

```
Agent config (2/2 selected: claude-code, codex)     15/15
```

or, in the legacy-fallback path (no manifest found):

```
Agent config (CLAUDE.md/AGENTS.md/GEMINI.md/.cursorrules present)   15/15
```

This also fixes a small pre-existing accuracy bug independent of Phase 2:
the current label lists 3 of the 4 files it actually checks for
(`.cursorrules` is checked in code but not named in the label).

---

## 8. Open Questions Requiring a Human Decision

1. **Multi-select UI shape.** The mockup (`ideas/04-kit.md` lines 72-77)
   shows "All (multi-agent)" as a 4th *single-select* radio option
   alongside 3 individual agents — it does NOT show a true checkbox
   multi-select UI. Does Phase 2 implement literally what the mockup shows
   (a binary "one agent" vs. "all 4 agents" choice, no partial subsets like
   "claude-code + codex only"), or a genuine `p.multiselect`-style checkbox
   list? These are materially different scopes: the mockup's literal
   interpretation is a much smaller change (add a 5th enum-like branch) than
   true multi-select (which needs array-typed answers, N-way generation
   logic, and touches every place enumerated in Section 4 regardless, but
   with a smaller combinatorial test surface if only "1 agent" and "exactly
   4 agents" are the two reachable states).
2. **Does `--yes` / `--template` support multi-agent in Phase 2?** (R9) —
   needs an explicit yes/no before implementation starts, not a default
   that falls out of whatever the interactive-wizard refactor happens to
   produce.
3. **Is the `.claude/hooks/verify.sh`-for-cursor behavior (R8) intentional
   product design or an accident inherited from Phase 1?** If accidental,
   should Phase 2 correct it (write cursor's hook nowhere, since Cursor has
   no hook system) or preserve it as-is to avoid unrelated scope creep? This
   review recommends preserving as-is for Phase 2 and filing a separate
   ticket, but the underlying intent should be confirmed with whoever wrote
   the original Phase 1 logic.
4. **Should native Codex/Gemini hook integration (`.codex/hooks.json`,
   `.gemini/settings.json` hook registration with the JSON stdin/stdout
   contract) be a tracked future phase?** This review's research (see hook
   convention findings, Section 1 R4) confirms both tools have real,
   distinct, documented hook systems as of 2026 that Kit does not currently
   integrate with at all — today's `.loop/verify.sh` / `.claude/hooks/
   verify.sh` are conventions referenced only in prose (CLAUDE.md/AGENTS.md/
   GEMINI.md text), not wired into any agent's actual hook-execution
   mechanism, even for Claude Code (no `.claude/settings.json` hook
   registration exists in the generator today). This is arguably a bigger
   gap than multi-agent selection itself, but it's out of scope for this
   review to resolve — flagging it so it isn't silently conflated with
   Phase 2 multi-agent work.
5. **Persisted manifest format and location** (Section 2) — is a new
   `.loop/kit.json` acceptable, or should agent-selection state instead be
   folded into the existing `.loop/budget.yaml` (simpler, one fewer file,
   but mixes concerns and requires extending an already-tested schema) or
   some other existing file? Needs a decision before `score.ts` changes are
   implemented, since the test matrix (TM-8, TM-9, TM-10) depends on knowing
   where this state lives.
6. **Should the overwrite-warning behavior (R1/TM-7) actually be built in
   Phase 2, or is it explicitly out of scope** given `FINDINGS.md` #6
   already accepted single-file overwrite as a design choice? This review's
   position is that 4x blast radius is a big enough change in risk profile
   to warrant revisiting that acceptance, but the original decision-maker
   should confirm or explicitly re-affirm the "ACCEPTED" verdict for the
   multi-agent case.
