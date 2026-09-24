# Phase 3 Adversarial Review: Wizard Test Coverage

**Status:** Planning only — no source code was written or modified to produce this document.
**Subject:** `runWizard()` in `src/cli/init.ts` (lines 104-199), invoked from the `init` action handler (lines 41-102), which feeds `runGeneration()` (lines 222-265).
**Reviewer stance:** Independent, adversarial. This document does not assume the parallel implementation plan is correct; it stress-tests the three most likely approaches (PTY emulation, module mocking, testability refactor) before any of them is chosen.

---

## 0. Confirmed facts (verified directly, not assumed)

- `runWizard` issues 5 prompts unconditionally and 1 conditionally:
  1. `p.text` — task description, `validate` rejects empty/whitespace (line 108-114)
  2. `p.select` — verification method: `test-suite | build-passes | lint-clean | custom` (line 118-134)
  3. **Conditional** `p.text` — custom command, only when step 2 === `"custom"`, `validate` rejects empty (line 139-149)
  4. `p.select` — budget tier: `quick | standard | thorough | unlimited` (line 151-159)
  5. `p.select` — agent: `claude-code | codex | gemini | cursor`, with `initialValue` defaulted from auto-detection (line 166-175)
  6. `p.select` — iteration limit: `conservative | standard | thorough | unlimited`, mapped through `ITERATION_MAP` to a number (line 179-189)
- Every single prompt is followed immediately by `if (p.isCancel(x)) return null;` — six independent short-circuit points.
- Cancellation propagates: `runWizard` returns `null` → caller (line 96-99) calls `p.cancel(...)` and `process.exit(130)`.
- **Zero automated coverage exists today.** Confirmed by direct inspection:
  - `demo/test_e2e.sh` invokes `kit init` only with `--yes` (line 96, 130, 141, 183) or `--template <name>` (line 118, 171). Neither code path calls `runWizard` — both `opts.yes` and `opts.template` return before line 79 (`p.intro`) is ever reached.
  - `find src -path "*__tests__*"` returns 9 files, all under `detectors/`, `utils/`, `templates/`, `generators/`. **There is no `src/cli/__tests__/` directory at all** — not a gap within existing CLI tests, a total absence.
  - `vitest.config.ts` only includes `src/**/__tests__/**/*.test.ts`, so this isn't a config exclusion hiding tests elsewhere — no such tests exist anywhere in the repo.
- Environment facts relevant to risk analysis:
  - `package.json` has no `node-pty` (or any PTY library) as a dependency today — adopting PTY testing means a **new dependency**, not wiring up existing infra.
  - `.github/workflows/ci.yml` runs on `ubuntu-latest` only, matrixed on Node 20/22. **There is no macOS or Windows runner in CI.** Any claim that "it passes on my Mac" is not verified by CI at all today, PTY-based or not.
  - `@clack/core` (the engine under `@clack/prompts` 0.9.1) gates raw-mode terminal control behind `input.isTTY` checks (confirmed by reading `node_modules/@clack/core/dist/index.mjs`: `function d(t,u){const F=t;F.isTTY&&F.setRawMode(u)}`). This matters for both PTY and mocking analysis below.
  - `p.isCancel` works by comparing the resolved value against an internal `Symbol("clack:cancel")` created inside `@clack/core` and re-exported. It is **not** a generic "check for `undefined`" — cancellation is a specific symbol identity check. This is a load-bearing detail for mock-fidelity risk (Section 2).

---

## 1. Flakiness / fidelity risk analysis

### 1a. PTY-based terminal emulation (e.g., `node-pty` piping simulated keystrokes)

**Concrete flakiness vectors:**

- **Render-then-type race.** Clack renders each prompt asynchronously (it writes ANSI escape sequences, listens for `keypress` events, and updates internal state on a `render()` callback tied to stdout writes). A PTY-based test driver must wait for the prompt to actually be listening before writing simulated keystrokes, or the keystrokes arrive before `rl.on("keypress", ...)` is attached and are silently dropped. The only reliable "prompt is ready" signal is scraping PTY output for an expected string (e.g., "What's the task?"), which means every test becomes a string-match-then-write loop — sensitive to ANSI codes, terminal width, and Clack's internal frame-diffing (`node_modules/@clack/core` does line-diffing between frames, not full clears, which makes robust output-matching in PTY buffers meaningfully harder than "read the last line").
- **Escape-code timeout interactions.** `@clack/core`'s readline interface is created with `escapeCodeTimeout: 50` (confirmed in the source excerpt above). A PTY writer that sends multi-byte sequences (arrow keys, Enter) with any inter-byte delay risks tripping or missing this 50ms window under CI load, especially on shared/throttled CI runners where wall-clock timing is not guaranteed.
- **No macOS/Windows runner in this project's CI today.** This project's CI matrix is `ubuntu-latest` only. That means introducing PTY tests does not even buy the claimed benefit of "verified across platforms" — it verifies one platform, with a new dependency (`node-pty`) that is a native addon requiring platform-specific prebuilds. A contributor working on macOS with a different `node-pty` binary than CI's Linux binary can get local pass / CI fail (or vice versa) purely from native-binding drift, which is a categorically different (and harder to diagnose) failure mode than a pure-JS mock ever produces.
- **CI resource contention.** Timing-sensitive PTY tests (sleep-and-hope patterns, `waitFor(pattern, timeout)` polling) are the single most common source of "rerun the job and it passes" flakiness in CLI tooling generally. Once one flaky test lands, engineers stop trusting red CI, which is a worse outcome for a young project than having a documented coverage gap.

**Verdict: PTY testing is overkill for Kit at its current size and stage.** Kit is a single-maintainer CLI with 6 prompts. The cost (new native dependency, per-platform binary risk, timing-sensitive test authoring, a CI matrix that doesn't even cover multiple platforms today to justify it) is disproportionate to the benefit (catching bugs that a well-designed mock suite plus one manual smoke-test checklist already catches — see below). Recommend **against** PTY/`node-pty` for this phase. Revisit only if Kit later ships its own custom raw-terminal renderer (not the case — it delegates entirely to `@clack/prompts`) or if a PTY-only bug class is actually observed in the wild.

### 1b. Mocking `@clack/prompts` directly (`vi.mock`)

**Does it exercise real Clack rendering?** No — and it should not be expected to. Mocking `p.text`/`p.select` to resolve with canned values tests exactly one thing: **Kit's own branching and answer-mapping logic** (does step 3 fire only when step 2 is `"custom"`; does `ITERATION_MAP` map `"thorough"` to `25`; does a cancel at step N produce `null` without executing steps N+1..6). That is a reasonable and sufficient thing to test, given `@clack/prompts` is a well-maintained external dependency (9K+ dependents per the project's own rationale in `ideas/04-kit.md`) whose own rendering correctness is not Kit's responsibility to re-verify.

**The real risk — and it is real, not theoretical:** a mock-based suite can pass 100% while the wizard is broken in an actual terminal, specifically via a **Clack API misuse that only surfaces at runtime with a real prompt engine**. Concrete example classes:
- Passing an `options` array with a `value` that doesn't match the discriminated union Clack expects (Clack is loosely typed enough at its JS boundary — despite native TS types, `as const` casts like `verificationChoice as VerificationMethod | symbol` at line 118-134 bypass structural checking) — a canned mock never invokes Clack's actual option-rendering/selection code, so a bad `options` shape (e.g., accidentally duplicated `value`s across two options, which Clack would resolve ambiguously in real interaction) would never be caught.
- `initialValue` on the agent-select prompt (line 168) referencing a value that isn't present in `options` (e.g., if `detection.agents[0]` ever returns a string outside `AgentType`, which is only prevented by the type system, not runtime validation) — Clack would fail to preselect correctly in a real terminal; a mock that just returns a hardcoded resolved value never touches Clack's own default-selection logic and would not surface this.
- A `validate` function whose return type or truthiness Clack interprets differently than expected (e.g., returning `""` vs `undefined` vs `false` — Clack's real state machine treats these differently per the `@clack/core` source: `e&&(this.error=...,this.state="error")`, i.e. only a *truthy* string counts as invalid) — a mock never calls the real `validate` dispatch path at all unless the test suite explicitly re-implements it.
- **A subtler, Kit-specific pitfall for the mocking approach itself:** `p.isCancel` is not a generic falsy/undefined check — it compares against a `Symbol("clack:cancel")` created inside `@clack/core` (confirmed by source inspection above). If the implementing agent does a blanket `vi.mock("@clack/prompts")` that auto-mocks the entire module namespace (including `isCancel`), and then also mocks `p.text`/`p.select` to return some ad-hoc "cancel" sentinel that isn't the real symbol, **the cancel-detection branches (`if (p.isCancel(x)) return null;`) will never fire in tests even though they're the single most safety-critical part of this function.** The only correct pattern is to use `vi.importActual("@clack/prompts")` to keep the real `isCancel` (and the real cancel symbol) while overriding only `text`/`select`/`spinner`/etc., and to have mocked prompts resolve with that real, imported cancel symbol to simulate Ctrl+C. This must be called out explicitly as an implementation requirement, not left to the other agent's discretion, because getting it wrong produces a test suite that looks green while testing nothing about cancellation — the exact class of bug FINDINGS #25 was about.

**Required complementary manual/smoke test:** regardless of how thorough the mock suite is, it must be paired with a **documented manual smoke-test checklist** run at minimum once per release (and ideally by a human, in a real terminal, on at least macOS and Linux) that walks the full `kit init` interactive flow end to end: type a task, select each verification option in turn across separate runs (paying particular attention to "Custom command" since that's the conditional branch and a previously-fixed bug per FINDINGS #12), select each budget/agent/iteration option, and confirm Ctrl+C at each of the 6 prompts produces exit code 130 and no partial file writes. This is not optional — it is the only check in the whole pipeline that would catch a real Clack-API-shape bug that a mock, by construction, cannot see. This checklist should live in the repo (e.g., `context/wizard-smoke-test-checklist.md` or appended to `RELEASING.md`/`FINDINGS.md`) so it survives as an artifact, not tribal knowledge.

**Verdict:** Mocking `@clack/prompts` via `vi.mock` + `vi.importActual` for `isCancel`/the cancel symbol is the right primary tool for this phase — cheap, fast, deterministic, and matched to what's actually Kit's responsibility to test. It must be explicitly scoped as "tests Kit's branching, not Clack's rendering," and must be paired with the manual smoke checklist above as a permanent companion, not a one-time pre-launch step.

### 1c. Testability refactor (extract pure decision logic from I/O)

Addressed in Section 2, since the sequencing question is the crux of the risk.

---

## 2. Recommended safe sequencing (tests before refactor)

**The circularity the task description flags is real and must be resolved in this order, not avoided:**

A refactor that extracts pure logic (e.g., a `decideNextStep(answers, detectionDefaults)` function, or a state-machine table describing the 6-step sequence, defaults, and conditional branch) is *desirable* for long-term testability, but doing it **before** any test exists means the only verification that the refactor preserved behavior is manual line-by-line diffing against the original — exactly the failure-prone process this phase exists to replace. The risk is concrete and specific to this function: it would be trivially easy for a refactor to silently reorder the budget/agent/iteration prompts, drop the `validate` empty-check on the custom-command prompt, change `initialValue` on the agent-select from `defaultAgent` to a hardcoded value, or change `ITERATION_MAP`'s fallback (`?? 10` at line 197) — all of which are behavior-preserving-looking edits that are easy to get subtly wrong and hard to notice in review because the diff "looks like" a mechanical extraction.

**Mandatory sequencing:**

1. **Characterize current behavior first, via the mock-based approach from Section 1b, against `runWizard` exactly as it exists today** (lines 104-199, untouched). Write tests that pin: the exact prompt order, the exact `options` values/labels/hints per prompt, the conditional trigger condition (`verificationChoice === "custom"`), every `p.isCancel` short-circuit point (one test per prompt position, 6 total), the `ITERATION_MAP`/`BUDGET_MAP` translation, and the exact shape of the returned `WizardAnswers` object for a representative set of input combinations.
2. **Only after that suite is green and reviewed** should any refactor to extract pure logic be attempted (if the team decides it's worth doing — see Scope Boundary below, since this phase's goal is coverage, not refactoring).
3. **If a refactor is done, it must not touch the test file.** The pre-existing suite from step 1 is the regression oracle — if the refactor requires changing test expectations (beyond adjusting *how* a function is imported/invoked, e.g., testing a newly-extracted `computeIterationCount()` helper directly instead of only through `runWizard`), that is a signal the refactor changed behavior and needs explicit sign-off, not a silent test update.
4. Run the full existing suite (`generators`, `detectors`, `templates`, `utils` — all currently passing) plus the new wizard suite plus `demo/test_e2e.sh` after any refactor, before merging.

**Explicit recommendation:** given Phase 3's stated goal is "add test coverage," the refactor should be treated as **out of scope for this phase** unless the chosen mocking strategy proves unworkable without it (unlikely, per Section 1b — `vi.mock` + `vi.importActual` works against `runWizard` as it stands today, with no extraction needed). Bundling a refactor into the same phase as "first tests ever written for this function" maximizes exactly the risk this section is about. Recommend: **ship the characterization test suite in Phase 3; defer any extraction refactor to a later phase, gated on the new suite being in place for at least one release cycle.**

---

## 3. Scope boundary definition

**In scope for this phase** (wizard-specific, not duplicated elsewhere):

- Prompt **sequencing**: task → verification-method → (conditional custom-command) → budget → agent → iterations, in that exact order, with the conditional branch firing only for `"custom"`.
- **Cancel handling** at each of the 6 possible cancellation points, confirming `runWizard` returns `null` and that no later prompt in the sequence is invoked after a cancel (i.e., cancelling at step 2 must not call the mocked `p.text` for step 3).
- **Answer-mapping / translation logic**: `ITERATION_MAP` string→number mapping including the `?? 10` fallback; the conditional inclusion of `customCommand` in the returned object (present only when verification is `"custom"`, `undefined` otherwise — confirmed at line 138 `let customCommand: string | undefined;`); `defaultAgent` fallback to `"claude-code"` when `detection.agents` is empty (line 163-164) and correct use of `detection.agents[0]` when populated, threaded into both the `initialValue` of the agent prompt and (separately, already tested in `buildDefaults`) the `--yes` path.
- **Validation wiring**: that the `validate` functions passed to the task-text and custom-command-text prompts are the ones actually asked (empty/whitespace-only input rejected) — testable by invoking the captured `validate` callback the mock receives, without needing real Clack rendering.
- **Top-level `init` action's own branching** around `runWizard`: that `opts.template` and `opts.yes` paths bypass `runWizard` entirely (already implicitly covered by `test_e2e.sh`, but a fast unit-level confirmation belongs here too since it's adjacent branching in the same file), and that a `null` return from `runWizard` results in `p.cancel(...)` + `process.exit(130)` (this is the FINDINGS #25 regression test — see Section 4) without ever calling `runGeneration`.

**Explicitly out of scope for this phase** (already covered elsewhere — do not duplicate):

- **File generation correctness** (contents of `CLAUDE.md`, `AGENTS.md`, hook scripts, `budget.yaml`, etc.) — this is `generateAll`'s job, already covered by `src/generators/__tests__/generators.test.ts` and `hooks.test.ts`. A wizard test that asserts on generated file *contents* is scope creep; it should assert only that `runGeneration` was *called* with the correct `WizardAnswers` object (i.e., mock `generateAll` itself in wizard tests, verifying the wizard→generator hand-off contract, not re-verifying the generator's internals).
- **Detection logic** (`detectAll`, `detectVerification`) — covered by `src/detectors/__tests__/`. Wizard tests should pass in a fixed, hand-constructed `DetectionResult` rather than exercising real filesystem detection.
- **Template loading/validation** — covered by `src/templates/__tests__/registry.test.ts`. The `--template` path in `init.ts` doesn't even call `runWizard`, so it's naturally excluded, but worth stating explicitly so no one "helpfully" adds template-flow assertions to the new wizard test file.
- **End-to-end process spawning / full CLI invocation** (spawning `kit init` as a subprocess and asserting on stdout) — this is `demo/test_e2e.sh`'s job for the non-interactive paths, and is precisely the PTY-territory this review recommends against for the interactive path (Section 1a). Do not add a new E2E script step that tries to drive `kit init` interactively via raw subprocess stdin piping as a substitute for proper mock-based unit tests — that reintroduces PTY-class flakiness through the back door without even the `node-pty` keystroke/render synchronization primitives.

**One-sentence boundary:** *this phase tests that `runWizard` asks the right questions in the right order, stops correctly on cancel, and hands off the right `WizardAnswers` shape — it does not re-test what happens to that shape once it leaves `runWizard`.*

---

## 4. Regression test requirements (from FINDINGS.md)

Two previously-fixed wizard bugs are named explicitly in the task and confirmed present in `FINDINGS.md`:

| # | Finding (verbatim from FINDINGS.md) | Required regression test |
|---|---|---|
| **#12** | HIGH — "Custom command" verification never prompts for the actual command. Selecting "Custom command" provided no follow-up prompt; the placeholder `echo '...'` exited 0, so verification always passed. Fixed by adding `p.text()` follow-up, threaded via `WizardAnswers.customCommand`. | A test that selects `"custom"` at the verification-method step and asserts: (a) the custom-command `p.text` prompt **is** invoked (not skipped), (b) an **empty/whitespace-only** custom command is rejected by `validate` (mirrors the original bug's "silently passes" failure mode — the regression isn't just "prompt exists" but "prompt enforces non-empty input"), and (c) a non-empty custom command ends up as `WizardAnswers.customCommand` in the returned object. A companion test selecting any *other* verification method must assert the custom-command prompt is **never** invoked and `customCommand` is `undefined` on the returned object — this is the branch-condition half of the same regression. |
| **#25** | LOW (reclassified from Medium) — `process.exit(0)` on wizard cancel meant chained commands (`kit init && deploy`) proceeded as if init succeeded. Fixed: `process.exit(130)`. | A test (or parametrized set of 6 tests, one per prompt position) that simulates a cancel (the real `@clack/core` cancel symbol, per Section 1b's mocking-fidelity requirement — not an ad-hoc sentinel) at each prompt in turn, and asserts the process would exit with code **130**, not 0 or 1. Since `process.exit` is itself a side effect that should be mocked/spied in unit tests (calling the real `process.exit` inside a Vitest run kills the test runner), the assertion should be against a spied `process.exit` call with argument `130`, and separately that `p.cancel(...)` (not silence) was invoked first. Test at minimum: cancel at prompt 1 (task) and cancel at prompt 6 (iterations) as boundary cases, since a sequencing bug is more likely to manifest at the first-or-last position than in the middle. |

Both regressions should live as named test cases (e.g., `it("regression #12: ...")`, `it("regression #25: ...")`) so their provenance is traceable back to `FINDINGS.md` for future auditors, matching this project's existing practice of numbering findings.

---

## 5. Acceptance criteria — "this phase is done when..."

- [ ] A `src/cli/__tests__/init.test.ts` (or equivalent) file exists — closing the confirmed zero-coverage gap.
- [ ] `@clack/prompts` is mocked via `vi.mock("@clack/prompts", async (importOriginal) => ...)` preserving the **real** `isCancel` and the **real** cancel symbol via `importOriginal`/`vi.importActual` — verified by inspecting the mock setup, not just trusting it (a reviewer should specifically check this, per Section 1b's warning that getting this wrong silently defeats the cancel tests).
- [ ] All 6 prompts in `runWizard` have a passing test for: normal (non-cancel) resolution, and cancel resolution producing `null` with no downstream prompts invoked.
- [ ] The conditional custom-command branch has tests for both the "custom selected" and "custom not selected" paths (see Section 4, FINDINGS #12).
- [ ] `process.exit(130)` on wizard cancel is regression-tested with `process.exit` spied, not actually invoked (see Section 4, FINDINGS #25).
- [ ] `ITERATION_MAP` and the `defaultAgent` fallback logic are covered for both the "detection found an agent" and "detection found nothing" cases.
- [ ] No new test asserts on generated file contents, detection internals, or template internals (Section 3) — a reviewer should be able to point to any assertion in the new test file and say which of the 6 in-scope categories it belongs to.
- [ ] `npm run test`, `npm run typecheck`, `npm run lint`, and `demo/test_e2e.sh` all still pass unmodified (the E2E script's non-interactive paths are the safety net that the new suite must not weaken or replace).
- [ ] A manual smoke-test checklist for the real interactive flow (Section 1b) is written down somewhere durable in the repo (not just performed once and forgotten) and referenced from `FINDINGS.md` or a release checklist.
- [ ] No `node-pty` or other PTY dependency was added (per the Section 1a verdict) — if a future phase overturns this verdict, that should be a deliberate, separately-reviewed decision, not something that crept in via this phase.
- [ ] If any refactor of `runWizard` was done, it happened strictly after the characterization suite above was merged and green (Section 2) — verified by commit order/PR structure, not just by asking.

---

## 6. Test matrix

All tests below assume `p.text`/`p.select`/`p.spinner`/`p.note`/`p.intro`/`p.outro`/`p.cancel` are mocked per Section 1b, with `isCancel` and the cancel symbol preserved from the real module via `vi.importActual`.

| # | Scenario | Mocked inputs (in call order) | Expected output / assertion |
|---|---|---|---|
| 1 | Full happy path, all defaults | task=`"Fix bug"`, verify=`"test-suite"`, budget=`"standard"`, agent=`"claude-code"`, iterations=`"standard"` | Returns `{task:"Fix bug", verification:"test-suite", customCommand:undefined, budget:"standard", agent:"claude-code", iterations:10}` |
| 2 | Custom verification selected, valid command given | task=`"x"`, verify=`"custom"`, customCmd=`"npm run e2e"`, budget=`"quick"`, agent=`"codex"`, iterations=`"conservative"` | Custom-command prompt **is** called; result includes `customCommand:"npm run e2e"`, `iterations:5` (regression #12 — happy path) |
| 3 | Custom verification selected, then cancelled at the custom-command prompt | task=`"x"`, verify=`"custom"`, customCmd=CANCEL | Returns `null`; budget/agent/iteration prompts **never called** (regression #12 — cancel-mid-conditional edge case) |
| 4 | Non-custom verification selected | task=`"x"`, verify=`"build-passes"`, ... | Custom-command `p.text` **never invoked**; result has `customCommand:undefined` (regression #12 — negative case) |
| 5 | Cancel at prompt 1 (task) | task=CANCEL | Returns `null`; **no** other prompt (`select` for verification, etc.) invoked at all |
| 6 | Cancel at prompt 2 (verification select) | task=`"x"`, verify=CANCEL | Returns `null`; custom-command/budget/agent/iteration never invoked |
| 7 | Cancel at prompt 4 (budget select) | task=`"x"`, verify=`"lint-clean"`, budget=CANCEL | Returns `null`; agent/iteration never invoked |
| 8 | Cancel at prompt 5 (agent select) | ..., agent=CANCEL | Returns `null`; iteration prompt never invoked |
| 9 | Cancel at prompt 6 (iterations select, last prompt) | ..., iterations=CANCEL | Returns `null` (boundary case — confirms cancel handling isn't accidentally skipped on the last prompt because there's "nothing after it to protect") |
| 10 | Top-level: `runWizard` returns `null` | (any cancel case, e.g. #5) | `init` action calls `p.cancel("Setup cancelled.")` and `process.exit(130)` is called (spied) — NOT `process.exit(0)` or `process.exit(1)` (regression #25); `runGeneration` is **never called** |
| 11 | Top-level: `runWizard` returns answers | happy path | `runGeneration` **is** called with exactly the `WizardAnswers` object `runWizard` returned (spy on `runGeneration` or the module boundary it crosses; do not assert on files written — see Scope Boundary) |
| 12 | Empty/whitespace task rejected | task validate callback invoked with `""` and `"   "` | Both return the string `"Task is required"` (truthy → Clack would re-prompt); a non-empty string returns `undefined` |
| 13 | Empty custom command rejected | custom-command validate callback invoked with `""` | Returns `"Command is required"` |
| 14 | `ITERATION_MAP` fallback | iterations=`"conservative"` / `"standard"` / `"thorough"` / `"unlimited"` / an unrecognized string | Maps to `5 / 10 / 25 / 0 / 10` respectively (last case exercises the `?? 10` fallback at line 197 — arguably unreachable via real Clack `select` since options are fixed, but worth asserting the fallback exists and is correct as defensive-code documentation) |
| 15 | Agent default when detection found agents | `detection.agents = ["codex"]` | Agent-select prompt's `initialValue` option passed to the mocked `p.select` call is `"codex"` (assert on the mock's call arguments, not just the final answer) |
| 16 | Agent default when detection found nothing | `detection.agents = []` | Agent-select prompt's `initialValue` is `"claude-code"` |
| 17 | Verification prompt hints reflect detection | `detection.stack = "typescript"`, `defaultVerifyCmd = "npx vitest run"` | Assert the `options` array passed to the mocked `p.select` for verification includes hint `"npx vitest run"` for `test-suite` and `"tsc --noEmit"` for `build-passes` (catches accidental hint-wiring regressions, e.g. swapped hints between options) |
| 18 | `--yes` and `--template` bypass `runWizard` | `opts.yes = true` / `opts.template = "fix-types"` | `runWizard` (or the mocked `p.intro`/`p.text`/`p.select` chain) is never invoked; confirms no accidental regression merges the interactive and non-interactive paths |

---

## 7. Open questions requiring a human decision

1. **Is the extraction refactor wanted at all for v1.0.0, or only "coverage first, refactor later (maybe never)"?** This review recommends deferring it (Section 2), but that's a scope call the project owner should make explicitly rather than have it default in via the other agent's plan.
2. **Where should the manual smoke-test checklist live, and who is accountable for running it?** For a single-maintainer project this may just mean "you, before every tagged release" — but it should be written down (Section 1b) so it isn't silently dropped once the mock suite exists and creates false confidence.
3. **Should `demo/test_e2e.sh` gain a non-PTY, mock-free "does `kit init` at least start and print the intro banner without crashing" smoke check** (e.g., piping EOF/immediate SIGINT to a spawned `kit init` subprocess and asserting a clean, fast failure rather than a hang)? This would be a cheap process-level guard against the wizard hanging or crashing on startup in a real subprocess, distinct from (and much lower-risk than) full PTY keystroke-driving — worth a deliberate yes/no rather than silent omission.
4. **What Node/OS versions must the mock-based suite be guaranteed to pass on**, given CI is currently Ubuntu-only? If the project's users are meaningfully on macOS/Windows (plausible for a local dev-tool CLI), should this phase also add a macOS runner to `ci.yml` even without PTY tests, purely to catch non-wizard platform issues? Out of scope for the wizard specifically, but adjacent enough to flag.
5. **Should the two FINDINGS regression tests (#12, #25) be tagged/labeled in a way that a future `FINDINGS.md` entry can reference back** (e.g., a shared `describe.each` block or comment convention), so that if a future audit re-finds either bug, it's immediately obvious the regression test existed and how it was defeated? Worth a decision on naming convention before the suite is written, not after.
6. **If the mocking approach reveals that `runWizard`'s current structure makes certain assertions awkward** (e.g., inspecting the exact `options` array passed to `p.select` requires the mock to capture call arguments rather than just return values), is that itself evidence the refactor should happen sooner rather than later — or is it an acceptable, one-time cost of characterization testing? This is a judgment call best made after the first draft of the test file exists, not predicted in advance.
