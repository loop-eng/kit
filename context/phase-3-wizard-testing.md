# Phase 3: Wizard Test Coverage — Implementation Plan

Status: **planning only** — no source changes made while writing this document.
Target file under test: `src/cli/init.ts`
New test file to create: `src/cli/__tests__/init.test.ts`

---

## 1. Problem Statement

`@loop-eng/kit`'s entire pitch rests on its interactive wizard. From
`ideas/04-kit.md` §"Why Clack (Not Inquirer or Prompts)":

> "Clack's connected vertical-bar UI is immediately recognizable and creates
> a premium feel... Beautiful CLI UX — Clack-powered prompts with spinners,
> progress bars, and color-coded output" is listed as developer-value item
> #6, and the "Interactive Wizard Flow" ASCII mockup is the second thing shown
> in the pitch doc, right after the one-liner.

This is the headline feature. It currently has **zero automated test
coverage**.

### Evidence

**`src/cli/init.ts:104-199`** — `runWizard()` is the entire interactive flow:
5 sequential questions (6 including the conditional custom-verification
follow-up), each guarded by a `p.isCancel()` check:

| Line | Call | Cancel check |
|------|------|--------------|
| 108-114 | `p.text()` — task | line 116 |
| 118-134 | `p.select()` — verification method | line 136 |
| 140-146 | `p.text()` — custom command (conditional, only if `verificationChoice === "custom"`) | line 147 |
| 151-159 | `p.select()` — budget | line 161 |
| 166-175 | `p.select()` — agent | line 177 |
| 179-187 | `p.select()` — iteration limit | line 189 |

`runWizard` is a module-private `async function` (not `export`ed, line 104).
It closes over `p.text`/`p.select`/`p.isCancel` from `@clack/prompts`, which
in a real run read from the actual TTY/stdin. There is no seam to inject
fake answers.

**`demo/test_e2e.sh`** — every one of the 11 test blocks invokes either
`kit init --yes` or `kit init --template <name>` (lines 96, 118, 130, 141,
171, 183). Grep confirms: `grep -c "kit init" demo/test_e2e.sh` finds no
invocation of plain `kit init` anywhere in the file. `--yes` and
`--template` both bypass `runWizard` entirely — they call `buildDefaults()`
(line 74) or construct `answers` directly from the template (lines 62-68).
**`runWizard` is never exercised by any test in the repo.**

**Unit tests** — `src/**/__tests__/*.test.ts` (9 files: `detectors/agent`,
`detectors/stack`, `detectors/test-runner`, `detectors/verification`,
`generators/generators`, `generators/hooks`, `templates/registry`,
`utils/fs`, `utils/git`) — none import from `src/cli/*`. There is no
`src/cli/__tests__/` directory at all today.

### Why it matters

- Every wizard code path — the 6 cancel points, the empty-string validation
  on the task prompt (line 111-113: `if (!v.trim()) return "Task is
  required"`), the conditional custom-command follow-up appearing/not
  appearing, the `ITERATION_MAP` lookup with its `?? 10` fallback
  (line 197) — is verified only by a human running `kit init` by hand.
- A regression here (e.g., swapping the order of two prompts, breaking the
  conditional custom-command branch, or a typo in `ITERATION_MAP`) would
  ship silently: `npm run test` (vitest) and `demo/test_e2e.sh` would both
  stay green because neither touches this code path.
- This is precisely the kind of regression that's expensive to catch
  manually and cheap to catch with a mocked-prompt unit test.

---

## 2. Approach Comparison

| Approach | How it works | Pros | Cons / CI risk | Verdict |
|---|---|---|---|---|
| **A. PTY emulation** (`node-pty` or raw `child_process` + timed `stdin.write()`) | Spawn the real built CLI binary in a pseudo-terminal, send keystrokes (including arrow keys for `select`), scrape stdout for prompt text, assert on generated files. | Tests the *real* rendering path end-to-end, closest to what a user experiences; no source changes needed. | `node-pty` has a documented, unresolved flaky bug where PTYs exit early on GitHub Actions Linux runners when io_uring is enabled (microsoft/node-pty#630) and separate reports of intermittent output truncation (#85) — both reproduce in containerized CI, i.e. exactly our CI environment (`ubuntu-latest`). Raw `child_process` + `stdin.write()` avoids the native-binding risk but trades it for timing races: you must wait for each prompt to finish rendering before writing the next answer, and delays that work locally are exactly the kind of thing that flakes under load on a shared CI runner. Also requires building the CLI first (`npm run build`) inside the unit-test step, coupling `vitest` to `tsup` output — today `npm run test` runs directly against source. Slowest option by a wide margin (real process spawn + terminal I/O per test vs. in-process function calls). | **Not recommended** as the primary mechanism. Already effectively covered at a coarser grain by `demo/test_e2e.sh` for `--yes`/`--template`; extending that script to drive the interactive path would inherit the same PTY flakiness for zero net-new confidence over option B. |
| **B. Module mocking** (`vi.mock("@clack/prompts")`, feed canned resolved values to `p.text`/`p.select`/`p.isCancel` in call order) | Replace the entire `@clack/prompts` module with `vi.fn()` stubs. Each test queues return values matching the exact call sequence in `runWizard`, then asserts on the returned `WizardAnswers`. | Runs fully in-process, no TTY, no child process, no native bindings — deterministic and fast (milliseconds per test). This is the pattern Clack's own maintainers document for consumers (mocking the whole module) as distinct from Clack's *internal* test suite (which uses `MockReadable`/`MockWritable` streams to test the prompts themselves — not applicable here since we're testing *our* code, not Clack's rendering). Matches the existing repo convention: `vitest` + `describe`/`it`, already used across all 9 existing test files. | Doesn't exercise real terminal rendering (acceptable — that's Clack's own test responsibility, not ours) or true keypress handling (also acceptable — `select`'s keyboard nav is Clack's implementation, not `kit`'s). Requires `runWizard` to be exported (trivial, see §3). Because `p.text` is called for both the task prompt and the conditional custom-command prompt, tests must track *which* invocation they're on — mitigated with `mockResolvedValueOnce` chaining (see §3). | **Recommended primary mechanism.** |
| **C. Logic-extraction refactor** (pull the decision logic — `ITERATION_MAP` lookup, `budgetTierFromUsd`, final `WizardAnswers` assembly — out of the awaited I/O calls into pure functions) | Isolate anything that isn't literally "call `p.text`/`p.select` and check `isCancel`" into standalone functions that take primitive inputs and return `WizardAnswers` or a piece of it, testable with zero mocking. | Pure functions need no mocks at all — fastest, simplest, most robust tests; also improves readability. `budgetTierFromUsd` (line 215-220) is *already* extracted this way and already deserves direct unit tests it doesn't have. | On inspection, `runWizard`'s actual "decision logic" is thin: `BUDGET_MAP`/`ITERATION_MAP` are already module-level constants (lines 22-34), `budgetTierFromUsd` is already a standalone pure function. The only non-trivial bit is the final assembly (`customCommand` conditionally included, `ITERATION_MAP[...] ?? 10` fallback, lines 191-198). A *full* decomposition (e.g., a state-machine object mapping each question to its "next step") would change the shape of `runWizard` more than the testability gain justifies, and risks introducing exactly the kind of behavior drift the task explicitly rules out. | **Adopt partially** — extract only the final-assembly block into a pure helper (see §3); do not restructure the question sequence itself. |

### Recommendation

Combine **B + partial C**: mock `@clack/prompts` at the module level to drive
`runWizard` through every branch, and extract the one genuinely
non-trivial piece of pure logic (final `WizardAnswers` assembly, including
the iteration fallback and conditional `customCommand`) into a standalone
function that also gets direct, mock-free unit tests. Do not pursue PTY
emulation — it would duplicate coverage `demo/test_e2e.sh` already
provides for the non-interactive paths, while introducing a documented,
unresolved class of CI flakiness for the interactive path specifically.

---

## 3. Detailed Implementation Steps

### Step 1 — Minimal testability refactor (behavior-preserving)

**Before** (`src/cli/init.ts`):

```ts
async function runWizard(
  detection: ReturnType<typeof detectAll>,
  defaultVerifyCmd: string,
): Promise<WizardAnswers | null> {
  const task = await p.text({ /* ... */ });
  if (p.isCancel(task)) return null;
  // ... 5 more prompts ...
  return {
    task: task as string,
    verification: verificationChoice as VerificationMethod,
    customCommand,
    budget: budgetChoice as BudgetTier,
    agent: agentChoice as AgentType,
    iterations: ITERATION_MAP[iterationChoice as string] ?? 10,
  };
}
```

**After** — two changes only, no behavior change:

1. Export `runWizard` so the test file can import and call it directly:

```ts
export async function runWizard(
  detection: ReturnType<typeof detectAll>,
  defaultVerifyCmd: string,
): Promise<WizardAnswers | null> {
  // ...body unchanged down to the final `return { ... }`...
```

2. Extract the final assembly block into a pure, separately-exported
   helper, and call it from `runWizard`'s `return` statement:

```ts
export interface RawWizardChoices {
  task: string;
  verification: VerificationMethod;
  customCommand?: string;
  budget: BudgetTier;
  agent: AgentType;
  iterationChoice: string;
}

export function assembleWizardAnswers(raw: RawWizardChoices): WizardAnswers {
  return {
    task: raw.task,
    verification: raw.verification,
    customCommand: raw.customCommand,
    budget: raw.budget,
    agent: raw.agent,
    iterations: ITERATION_MAP[raw.iterationChoice] ?? 10,
  };
}
```

   `runWizard`'s tail becomes:

```ts
  return assembleWizardAnswers({
    task: task as string,
    verification: verificationChoice as VerificationMethod,
    customCommand,
    budget: budgetChoice as BudgetTier,
    agent: agentChoice as AgentType,
    iterationChoice: iterationChoice as string,
  });
}
```

3. Also `export` `budgetTierFromUsd` (line 215) and `buildDefaults`
   (line 201) — both are already pure/near-pure and already deserve direct
   coverage; exporting costs nothing and removes the need to exercise them
   indirectly through `--template`/`--yes` E2E runs alone.

No other line in `init.ts` changes. `ITERATION_MAP`/`BUDGET_MAP` stay where
they are. The prompt call sequence, messages, options, and validation
functions are untouched — this is purely adding `export` keywords and
factoring five lines of object-literal construction into a named function.

### Step 2 — New test file: `src/cli/__tests__/init.test.ts`

Mirrors the existing convention (`vitest` globals, `describe`/`it`, no
custom test harness) seen in `src/generators/__tests__/generators.test.ts`.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as p from "@clack/prompts";
import { runWizard, assembleWizardAnswers, budgetTierFromUsd, buildDefaults } from "../init.js";
import type { DetectionResult } from "../../types.js";

// A unique sentinel distinct from any real prompt answer, standing in for
// Clack's internal cancel symbol. isCancel is mocked to recognize it.
const CANCEL = Symbol("cancel");

vi.mock("@clack/prompts", () => ({
  text: vi.fn(),
  select: vi.fn(),
  isCancel: vi.fn(),
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  cancel: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
}));

const detection: DetectionResult = {
  stack: "typescript",
  testRunner: "vitest",
  agents: ["claude-code"],
  verificationCommand: "npx vitest run",
};

beforeEach(() => {
  vi.clearAllMocks();
  // Recognize the cancel sentinel regardless of how many times isCancel
  // has already been called in this test — no call-count bookkeeping needed.
  vi.mocked(p.isCancel).mockImplementation(
    (v: unknown): v is symbol => v === CANCEL,
  );
});

describe("runWizard — happy path", () => {
  it("produces a correct WizardAnswers for the full non-custom flow", async () => {
    vi.mocked(p.text).mockResolvedValueOnce("Fix all TypeScript errors"); // task
    vi.mocked(p.select)
      .mockResolvedValueOnce("test-suite")   // verification
      .mockResolvedValueOnce("standard")     // budget
      .mockResolvedValueOnce("claude-code")  // agent
      .mockResolvedValueOnce("thorough");    // iteration

    const answers = await runWizard(detection, "npx vitest run");

    expect(answers).toEqual({
      task: "Fix all TypeScript errors",
      verification: "test-suite",
      customCommand: undefined,
      budget: "standard",
      agent: "claude-code",
      iterations: 25,
    });
  });

  it("prompts for and includes a custom command when verification is 'custom'", async () => {
    vi.mocked(p.text)
      .mockResolvedValueOnce("Fix issues")            // task
      .mockResolvedValueOnce("npm test && npm run lint"); // custom command
    vi.mocked(p.select)
      .mockResolvedValueOnce("custom")        // verification
      .mockResolvedValueOnce("quick")         // budget
      .mockResolvedValueOnce("codex")         // agent
      .mockResolvedValueOnce("conservative"); // iteration

    const answers = await runWizard(detection, "npx vitest run");

    expect(p.text).toHaveBeenCalledTimes(2);
    expect(answers?.customCommand).toBe("npm test && npm run lint");
    expect(answers?.verification).toBe("custom");
    expect(answers?.iterations).toBe(5);
  });

  it("does not prompt for a custom command when verification is not 'custom'", async () => {
    vi.mocked(p.text).mockResolvedValueOnce("Fix issues");
    vi.mocked(p.select)
      .mockResolvedValueOnce("lint-clean")
      .mockResolvedValueOnce("unlimited")
      .mockResolvedValueOnce("gemini")
      .mockResolvedValueOnce("unlimited");

    await runWizard(detection, "npx vitest run");

    expect(p.text).toHaveBeenCalledTimes(1); // only the task prompt
  });

  it("falls back to 10 iterations for an unrecognized iteration key", async () => {
    vi.mocked(p.text).mockResolvedValueOnce("task");
    vi.mocked(p.select)
      .mockResolvedValueOnce("test-suite")
      .mockResolvedValueOnce("standard")
      .mockResolvedValueOnce("claude-code")
      .mockResolvedValueOnce("not-a-real-key"); // defensive: ITERATION_MAP miss

    const answers = await runWizard(detection, "npx vitest run");
    expect(answers?.iterations).toBe(10);
  });
});

describe("runWizard — cancellation at every step", () => {
  it("returns null when the task prompt is cancelled", async () => {
    vi.mocked(p.text).mockResolvedValueOnce(CANCEL as never);
    const answers = await runWizard(detection, "npx vitest run");
    expect(answers).toBeNull();
    expect(p.select).not.toHaveBeenCalled();
  });

  it("returns null when the verification select is cancelled", async () => {
    vi.mocked(p.text).mockResolvedValueOnce("task");
    vi.mocked(p.select).mockResolvedValueOnce(CANCEL as never);
    const answers = await runWizard(detection, "npx vitest run");
    expect(answers).toBeNull();
  });

  it("returns null when the custom-command prompt is cancelled", async () => {
    vi.mocked(p.text)
      .mockResolvedValueOnce("task")
      .mockResolvedValueOnce(CANCEL as never);
    vi.mocked(p.select).mockResolvedValueOnce("custom");
    const answers = await runWizard(detection, "npx vitest run");
    expect(answers).toBeNull();
  });

  it("returns null when the budget select is cancelled", async () => {
    vi.mocked(p.text).mockResolvedValueOnce("task");
    vi.mocked(p.select)
      .mockResolvedValueOnce("test-suite")
      .mockResolvedValueOnce(CANCEL as never);
    const answers = await runWizard(detection, "npx vitest run");
    expect(answers).toBeNull();
  });

  it("returns null when the agent select is cancelled", async () => {
    vi.mocked(p.text).mockResolvedValueOnce("task");
    vi.mocked(p.select)
      .mockResolvedValueOnce("test-suite")
      .mockResolvedValueOnce("standard")
      .mockResolvedValueOnce(CANCEL as never);
    const answers = await runWizard(detection, "npx vitest run");
    expect(answers).toBeNull();
  });

  it("returns null when the iteration select is cancelled", async () => {
    vi.mocked(p.text).mockResolvedValueOnce("task");
    vi.mocked(p.select)
      .mockResolvedValueOnce("test-suite")
      .mockResolvedValueOnce("standard")
      .mockResolvedValueOnce("claude-code")
      .mockResolvedValueOnce(CANCEL as never);
    const answers = await runWizard(detection, "npx vitest run");
    expect(answers).toBeNull();
  });
});

describe("runWizard — task validation", () => {
  it("rejects an empty/whitespace task via the validate callback", () => {
    vi.mocked(p.text).mockResolvedValueOnce("real task");
    vi.mocked(p.select)
      .mockResolvedValueOnce("test-suite")
      .mockResolvedValueOnce("standard")
      .mockResolvedValueOnce("claude-code")
      .mockResolvedValueOnce("standard");

    // Don't await yet — just invoke runWizard to capture the config object
    // p.text was called with, then invoke its `validate` directly. This
    // tests kit's validator function in isolation from Clack's own
    // re-prompt loop (which is Clack's responsibility, not kit's).
    void runWizard(detection, "npx vitest run");
    const call = vi.mocked(p.text).mock.calls[0][0];
    expect(call.validate?.("")).toBe("Task is required");
    expect(call.validate?.("   ")).toBe("Task is required");
    expect(call.validate?.("fix bug")).toBeUndefined();
  });
});

describe("assembleWizardAnswers (pure)", () => {
  it("maps known iteration keys via ITERATION_MAP", () => {
    const answers = assembleWizardAnswers({
      task: "t",
      verification: "build-passes",
      budget: "quick",
      agent: "cursor",
      iterationChoice: "conservative",
    });
    expect(answers.iterations).toBe(5);
    expect(answers.customCommand).toBeUndefined();
  });

  it("defaults unknown iteration keys to 10", () => {
    const answers = assembleWizardAnswers({
      task: "t",
      verification: "test-suite",
      budget: "standard",
      agent: "claude-code",
      iterationChoice: "bogus",
    });
    expect(answers.iterations).toBe(10);
  });
});

describe("budgetTierFromUsd (pure)", () => {
  it.each([
    [0, "quick"], [5, "quick"],
    [6, "standard"], [20, "standard"],
    [21, "thorough"], [50, "thorough"],
    [51, "unlimited"], [1000, "unlimited"],
  ])("maps $%s to %s", (usd, tier) => {
    expect(budgetTierFromUsd(usd as number)).toBe(tier);
  });
});

describe("buildDefaults", () => {
  it("uses the first detected agent when available", () => {
    const d = buildDefaults(detection, "npx vitest run");
    expect(d.agent).toBe("claude-code");
    expect(d.verification).toBe("test-suite");
    expect(d.iterations).toBe(10);
  });

  it("falls back to claude-code when no agents are detected", () => {
    const d = buildDefaults({ ...detection, agents: [] }, "npx vitest run");
    expect(d.agent).toBe("claude-code");
  });
});
```

Notes on the sketch above:

- `vi.mock("@clack/prompts", ...)` is hoisted by Vitest, so it applies
  before `init.ts` is imported — this is required because `init.ts` does
  `import * as p from "@clack/prompts"` at module load time.
- `p.text` and `p.select` are each mocked once at the module level and
  reused across tests via `mockResolvedValueOnce` chains; `beforeEach`
  calls `vi.clearAllMocks()` so call counts/queues don't leak between
  tests.
- The task-validation test (§"runWizard — task validation") is the one
  slightly awkward case: Clack's real `text()` re-prompts internally when
  `validate` returns a string, but our mock just resolves immediately, so
  `runWizard` never sees the invalid value at all — the validator itself
  is a plain closure kit wrote and owns, so it's tested directly by
  capturing `p.text.mock.calls[0][0].validate` and invoking it, which is
  the standard way to unit-test a validate/format callback passed into a
  mocked library call without needing the library's re-prompt loop.

### Step 3 — Fold in the `init.ts` top-level action-handler gaps (task §5)

Checked against current coverage:

| Code path | Location | Currently covered? |
|---|---|---|
| Template not found → `p.cancel` + exit 1 | `init.ts:57-61` | Yes — `demo/test_e2e.sh` Test 8 (`assert_output_contains "invalid template name shows error" "not found"`) |
| `--yes` non-interactive path (`buildDefaults`) | `init.ts:73-77` | Yes, indirectly — E2E Test 1; now also directly via new `buildDefaults` unit tests above |
| `--template` path (budget/agent/iteration derivation) | `init.ts:56-71` | Yes, indirectly — E2E Test 2; `budgetTierFromUsd` now also directly unit tested |
| **`existsSync(dir) && !statSync(dir).isDirectory()` → exit 1** (FINDINGS.md #22) | `init.ts:44-47` | **No test anywhere.** No E2E block passes a `--dir` that points at an existing *file* rather than a directory or missing path. |

Recommend adding one small E2E block to `demo/test_e2e.sh` (cheapest,
consistent with how the sibling `score`/`status` `--dir` validation would
be tested, and avoids adding `process.exit` mocking machinery to the new
unit test file just for one line):

```bash
# ─── Test 12: --dir points at a file, not a directory (FINDINGS.md #22) ───
echo -e "${BOLD}12. --dir validation${RESET}"
T12_FILE="$DEMO_DIR/not-a-dir.txt"
echo "i am a file" > "$T12_FILE"
assert_output_contains "init rejects --dir pointing at a file" "not a directory" kit init --yes --dir "$T12_FILE"
echo ""
```

This is outside `src/cli/__tests__/init.test.ts` scope but is a direct,
low-cost consequence of the same audit and belongs in this phase's PR.

---

## 4. Full Branch Coverage Checklist

Every branch in `runWizard` (plus the two pure helpers and the one
top-level gap), mapped 1:1 to a planned test:

| # | Branch | Planned test name |
|---|---|---|
| 1 | Happy path, verification ≠ custom, all 5 prompts answered | `runWizard — happy path > produces a correct WizardAnswers for the full non-custom flow` |
| 2 | Happy path, verification = custom, 6th prompt appears | `runWizard — happy path > prompts for and includes a custom command when verification is 'custom'` |
| 3 | Custom-command prompt does NOT appear for non-custom verification | `runWizard — happy path > does not prompt for a custom command when verification is not 'custom'` |
| 4 | `ITERATION_MAP` fallback (`?? 10`) for an unmapped key | `runWizard — happy path > falls back to 10 iterations for an unrecognized iteration key` |
| 5 | Cancel at task prompt (step 1) | `runWizard — cancellation at every step > returns null when the task prompt is cancelled` |
| 6 | Cancel at verification select (step 2) | `... > returns null when the verification select is cancelled` |
| 7 | Cancel at custom-command prompt (step 2b, conditional) | `... > returns null when the custom-command prompt is cancelled` |
| 8 | Cancel at budget select (step 3) | `... > returns null when the budget select is cancelled` |
| 9 | Cancel at agent select (step 4) | `... > returns null when the agent select is cancelled` |
| 10 | Cancel at iteration select (step 5) | `... > returns null when the iteration select is cancelled` |
| 11 | Task validator rejects empty string | `runWizard — task validation > rejects an empty/whitespace task via the validate callback` (also covers whitespace-only and valid-string branches in the same test) |
| 12 | `assembleWizardAnswers` maps known iteration key | `assembleWizardAnswers (pure) > maps known iteration keys via ITERATION_MAP` |
| 13 | `assembleWizardAnswers` defaults unknown iteration key | `assembleWizardAnswers (pure) > defaults unknown iteration keys to 10` |
| 14 | `budgetTierFromUsd` all four tier boundaries | `budgetTierFromUsd (pure) > maps $%s to %s` (parametrized, 8 cases across the 4 boundaries) |
| 15 | `buildDefaults` uses first detected agent | `buildDefaults > uses the first detected agent when available` |
| 16 | `buildDefaults` falls back to claude-code with no agents detected | `buildDefaults > falls back to claude-code when no agents are detected` |
| 17 | Top-level: `--dir` points at an existing non-directory file | `demo/test_e2e.sh` Test 12: `init rejects --dir pointing at a file` |

That's 6 of 6 cancel points, the validation branch, the conditional
prompt's both states, the iteration fallback, both pure helpers fully
covered, and the one previously-untested top-level guard.

**Explicitly out of scope** (Clack's own responsibility, not kit's):
keyboard navigation within `select`, terminal rendering/redraw, spinner
animation frames, `p.note`/`p.intro`/`p.outro` visual output. These are
tested by Clack's own suite (`bombshell-dev/clack`), not by us re-testing
a third-party library's rendering.

---

## 5. CI Considerations

Current `.github/workflows/ci.yml`: runs on `ubuntu-latest`, matrix
`node-version: [20, 22]`, steps are `npm ci` → `typecheck` → `lint` →
`build` → `test` (`vitest run`).

- **Module-mocking approach (recommended) runs reliably in this CI.** No
  TTY is allocated, no child process is spawned for the test itself, no
  native addon (`node-pty` uses prebuilt/compiled native bindings) is
  introduced. `vi.mock` + `mockResolvedValueOnce` is pure JS/Vitest
  machinery already exercised by every other test file in the repo, on the
  same two Node versions.
- **No new CI step is needed.** `npm run test` already runs `vitest run`
  against `src/**/__tests__/**/*.test.ts` per `vitest.config.ts` — the new
  `src/cli/__tests__/init.test.ts` is picked up automatically by that glob.
- **The one new E2E line (§3, Step 3)** runs inside the existing
  `demo/test_e2e.sh`. Confirm whether that script currently runs in CI —
  it is invoked manually (`bash demo/test_e2e.sh`) but is **not** listed as
  a step in `ci.yml` today. This phase should also add a `run: bash
  demo/test_e2e.sh` step to `ci.yml` if E2E isn't already gating merges;
  if it's intentionally excluded from CI, note that in the PR description
  since the new `--dir`-validation assertion would otherwise only run
  locally.
- **Flakiness risk: effectively zero** for the mocked unit tests — no
  timers, no real I/O, no timing-sensitive `mockResolvedValueOnce` chains
  that depend on wall-clock ordering (everything is `await`ed in sequence,
  matching the mock queue exactly). The one thing to get right is queue
  length: if a test queues fewer `mockResolvedValueOnce` values than
  `runWizard` actually calls in that branch, the extra call resolves
  `undefined`, `p.isCancel(undefined)` returns `false` (per our mock impl),
  and the code proceeds with `undefined` cast to the target type — this
  would silently produce a wrong-but-not-crashing `WizardAnswers` rather
  than a failing test. Mitigate by asserting `toHaveBeenCalledTimes(n)` on
  `p.text`/`p.select` in each test (already done in the "does not prompt
  for a custom command" case; recommend adding it to the happy-path tests
  too) rather than relying solely on the final `WizardAnswers` shape.

---

## 6. Effort Estimate and Open Questions

### Effort estimate

| Task | Estimate |
|---|---|
| Refactor: export `runWizard`, `budgetTierFromUsd`, `buildDefaults`; extract `assembleWizardAnswers` | 0.5 hr |
| Write `src/cli/__tests__/init.test.ts` (17 test cases per §4) | 2–3 hr |
| Add E2E Test 12 (`--dir` non-directory) to `demo/test_e2e.sh` | 0.25 hr |
| Confirm/wire `demo/test_e2e.sh` into `ci.yml` if not already gating | 0.25–0.5 hr |
| Run full suite locally on Node 20 and 22 (or confirm CI matrix passes), fix any type-narrowing friction from the `as never`/mock casts | 0.5–1 hr |
| **Total** | **~4–5.5 hr** |

### Open questions

1. **Is `demo/test_e2e.sh` currently run in CI at all?** It's not present
   in `.github/workflows/ci.yml` today. If it's meant to be a
   local/manual-only smoke suite, the new `--dir`-file-guard assertion
   (§3 Step 3) needs a different home — either ported into the new
   `init.test.ts` with a `process.exit` spy, or `ci.yml` gets a new step.
   This plan defaults to "add it to CI" but that's a call for whoever owns
   the CI config.
2. **Should `runWizard`/`assembleWizardAnswers`/`budgetTierFromUsd`/
   `buildDefaults` be exported from `init.ts` only, or re-exported from a
   package entry point (`src/index.ts`)?** Exporting from `init.ts` alone
   is sufficient for the test file (`../init.js` relative import, same
   pattern `generators.test.ts` uses for `../index.js`) and keeps these
   functions out of the public npm package API surface, which seems
   correct since they're internal wizard plumbing, not something
   consumers of `@loop-eng/kit` as a library should call. Recommend:
   `init.ts`-local exports only, not re-exported from `src/index.ts`.
3. **Do we want a `toHaveBeenCalledTimes` assertion convention enforced
   across all wizard tests** (per the flakiness mitigation in §5), or is
   asserting the final `WizardAnswers` shape sufficient? Recommend
   requiring it in code review for this PR specifically, since it's the
   cheapest guard against a silently-wrong mock queue.
4. **Type friction**: `tsconfig.json` has `"include": ["src"]` with no
   `__tests__` exclusion, and `npm run typecheck` (`tsc --noEmit`) runs
   over all of `src`, including tests — confirmed by the fact that the 9
   existing `__tests__/*.test.ts` files already typecheck cleanly today.
   `p.text`/`p.select` are generically typed in `@clack/prompts`'s
   `.d.ts` (overloaded signatures depending on the options shape passed
   in); `vi.mock("@clack/prompts", () => ({ text: vi.fn(), ... }))`
   erases those overloads down to a bare `Mock`, so
   `vi.mocked(p.text).mockResolvedValueOnce("task")` and the `CANCEL as
   never` casts in the cancellation tests will very likely need explicit
   `as never`/`as unknown as string` casts to satisfy `strict: true`. This
   is cosmetic and test-only, but real — none of the existing 9 test
   files mock a generically-typed external module today, so this will be
   the first place this friction shows up, and it should be resolved with
   casts in the test file rather than by loosening `tsconfig.json`'s
   strictness.
