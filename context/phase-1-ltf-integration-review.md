# Phase 1 Adversarial Review: LTF Trace Integration for Kit

**Scope:** independent, planning-only verification document for closing the gap between kit's
pitch ("every scaffolded loop emits LTF traces by default") and its current MVP (a config
generator and a reader, but no writer). No code was written or modified to produce this
document. This is meant to be handed to a human reviewer alongside whatever implementation
plan a separate agent produced, to stress-test that plan before code gets written.

---

## 0. The headline finding (read this first)

**Kit's own `.loop/ltf.config.yaml` generator does not describe the real LTF format.**

`src/generators/ltf-config.ts` emits:

```yaml
ltf:
  version: "1.0"
  output: ".loop/trace.ltf.jsonl"
  format: "jsonl"
  fields:
    timestamp: true
    iteration: true
    action: true
    result: true
    cost_usd: true
    tokens: true
    duration_ms: true
  retention:
    max_entries: 1000
    max_size_mb: 10
```

The real spec (`ltf/spec/v1.0/schema.json`, `ltf/spec/v1.0/SPEC.md` §3.1) requires every phase
event to carry **`ltf_version`, `loop_id`, `timestamp`, `phase`** — these are the four
non-negotiable required fields, checked by `required: [...]` in the JSON Schema's phase-event
branch and enforced by `validatePhaseEvent`/`ValidateFine` in the Go CLI
(`ltf/cli/internal/validator/validator.go:122-131`, which hard-errors if `phase` is missing or
not one of `plan|act|verify|decide|error|terminate`).

Kit's declared `fields` list contains **none of `ltf_version`, `loop_id`, or `phase`**. If any
implementation takes `ltf-config.ts`'s `fields` object literally as "the shape of a trace line,"
every single line it emits will fail `ltf validate` — not with warnings, but with hard schema
errors, because `phase` (the field the entire spec organizes around — see the phase taxonomy in
§4) is silently absent from the config's own model of what a trace line contains.

This is not a hypothetical edge case; it is the config file that already exists in every kit
output today. Whatever plan closes this phase must **not** treat `ltf-config.ts`'s `fields` block
as authoritative for the writer's output shape. Recommend: keep `fields` only as an
enable/disable toggle for genuinely optional enrichment fields (`cost_usd`, `tokens`,
`duration_ms`, `action`, `result`), and hardcode `ltf_version`, `loop_id`, `timestamp`, `phase` as
always-present, non-configurable in the writer, and fix `ltf-config.ts` to stop implying
otherwise (add `phase: true` — always-on — to the fields doc, or restructure the comment so a
future reader doesn't repeat this mistake).

**Second headline finding: an existing, tested, production-grade writer already exists next
door.** `ltf/adapters/claude-code/ltf-hook.sh` + `install.sh` is a Claude Code `PostToolUse`/
`Stop` hook adapter that already emits fully spec-compliant events (correct `phase`,
`loop_id` via per-session state file, `iteration` tracking, `verification` objects, and a
`loop_summary` on session end). It has 34 passing bash tests (`test-hook.sh`) and has already
been through 3 rounds of the ltf project's own bug hunt (path traversal in `session_id`, `jq`
absence handling, BOM handling in the parsers, etc. — see `ltf/FINDINGS.md`). Any plan that
designs a brand-new writer from scratch without at least evaluating "just vendor/wrap this" is
reinventing a wheel that has already been through an adversarial audit. See §5 for how this
should factor into the recommendation.

---

## 1. LTF Spec Compliance Requirements (cited)

Source: `ltf/spec/v1.0/SPEC.md`, `ltf/spec/v1.0/schema.json`.

| Requirement | Citation | Concrete implication for kit's writer |
|---|---|---|
| Every phase-event line MUST have `ltf_version`, `loop_id`, `timestamp` (ISO-8601 w/ TZ), `phase` ∈ {plan, act, verify, decide, error, terminate}. | SPEC §3.1, schema.json phase-event branch `required` | A minimal-but-valid line is `{"ltf_version":"1.0","loop_id":"<uuid>","timestamp":"...Z","phase":"verify"}`. Anything omitting `phase` or using a non-enum value is a hard validator error, not a warning. |
| `iteration` is 1-indexed, integer, `minimum: 1`. | SPEC §3.2, schema.json | Iteration 0 (as kit's own `state.md` uses — see `generateStateMd()` which starts iteration at `0`) is **invalid** for LTF `iteration` if copied verbatim. The writer must not reuse kit's own 0-based iteration counter unmodified. |
| `verification` object should only appear on `phase: verify` events. | SPEC §3.8; Go validator emits a **warning** (not error) if present elsewhere (`validator.go:176-179`) | Low severity if violated, but easy to get right — only attach `verification` when phase is `verify`. |
| Loop summary is a distinct record type, discriminated by `"type":"loop_summary"` and MUST NOT have a `phase` field; requires `ltf_version, loop_id, type, started_at, ended_at, total_iterations, termination_reason`. | SPEC §5.1-5.2, schema.json summary branch, `validator.go:189-192` (explicit error if `phase` present) | If the mechanism ever tries to represent "loop ended" as a `phase:"terminate"` event *and* smashes summary fields onto the same object, that record is invalid. These must be two separate JSONL lines. |
| `termination_reason` must be one of a fixed enum (`goal_met`, `budget_exhausted`, `max_iterations`, `user_cancelled`, `error`, `spin_detected`, `stall_detected`). | SPEC §4.2, schema.json | Kit's `budget.yaml` convergence config (`stall_iterations`, `same_error_threshold`) maps naturally to `stall_detected`/`spin_detected`, but nothing today computes or emits these. Any writer that hardcodes `"user_cancelled"` (as the existing adapter's `handle_session_end` does — `ltf-hook.sh:274`, always emits `user_cancelled` regardless of actual reason) is spec-valid but **semantically wrong** most of the time. This is a known, still-unfixed limitation of the very adapter recommended in §5 — carry it forward as an open item, don't assume the adapter's summary logic is done just because it's tested.
| Tolerant reader / additive-only evolution: consumers MUST ignore unknown fields, and MUST NOT assume chronological ordering within a file. | SPEC §1.1 principles 2-3, §8 "Ordering" | Kit's writer does not need perfect ordering guarantees under concurrent writers — spec explicitly permits out-of-order lines. This *reduces* the severity of some race conditions in §2 below — a consumer is required to tolerate it — but garbled/interleaved bytes within a single line are still fatal (see next row). |
| File format: UTF-8, `\n` line separator, **each line is a single complete JSON object, no pretty-printing**. | SPEC §8 | Any writer that pretty-prints (`JSON.stringify(obj, null, 2)`) or splits one event across multiple lines breaks every downstream parser (all three reference parsers assume one JSON value per line). This sounds obvious but is exactly the kind of thing worth an explicit unit test (see test matrix). |
| `cost_usd ≥ 0`, `duration_ms ≥ 0`, `tokens.* ≥ 0`, integers where declared. | schema.json | The Go validator hard-errors on negative numbers or wrong JSON types (string where number expected, etc.) — `validator.go:144-162`. A writer using `parseInt`/`parseFloat` on shell-command output without validating the result (e.g., a verify script's exit code parsed from empty string) can easily produce `NaN` → `JSON.stringify(NaN)` → the literal token `NaN` in the output, which is **not valid JSON** and will break `JSON.parse` on read, not just schema validation. This is worse than a schema warning — it's a byte-level parse failure that can also corrupt kit's own `readTraces()` for that line (silently dropped, see §2). |
| MIME/extension: `.ltf.jsonl`, and a single file MAY contain multiple loops distinguished by `loop_id`. | SPEC §8 | Kit re-running `kit init` on an existing project must not truncate a pre-existing `trace.ltf.jsonl` from a prior loop run — see backward-compat test cases in §4. |

### What "compliant" actually requires, in one sentence

A line is compliant if it round-trips through `JSON.parse` to a single object containing at
minimum `ltf_version` (matching `^1\.`), a non-empty `loop_id`, an RFC-3339/ISO-8601
`timestamp`, and a `phase` from the closed enum (or, for summaries, the alternate required set
with `type:"loop_summary"` and no `phase`) — everything else is optional and additive. There
*is* a strict, machine-runnable validator (`ltf validate`, Go, JSON-Schema-backed) that a CI
smoke test for kit could shell out to, if the `ltf` binary or an npm/PyPI equivalent is available
as a dev dependency. That should be part of kit's own test suite, not just documentation.

---

## 2. Failure Mode Analysis

Severity key: **Critical** = corrupts/breaks downstream consumers or silently produces false
data; **High** = breaks the specific feature under realistic conditions; **Medium** = degrades
quality/fidelity but doesn't corrupt; **Low** = cosmetic/theoretical.

| # | Scenario | Mechanism(s) affected | What breaks | Severity |
|---|---|---|---|---|
| F1 | Kit reuses `writeFileSafe()` (from `src/utils/fs.ts`) to write trace lines. | c (helper subcommand), any mechanism that borrows kit's existing fs helpers without checking | `writeFileSafe` calls `writeFileSync(path, content, "utf-8")` — a **full overwrite**, not an append (`src/utils/fs.ts:4-7`). Every call after the first destroys all prior trace lines. This is the single most likely accidental regression given kit's existing utility surface only has "write whole file" helpers today, no `appendFileSafe`. | **Critical** |
| F2 | `verify.sh` crashes (e.g. `npm test` segfaults, OOM-kills the shell, or the harness itself is killed with SIGKILL) before reaching a trace-append line placed at the end of the script. | a (verify-hook) | No trace line for that iteration at all — not malformed, just absent. Downstream metrics (iteration counts, pass rate) undercount. Because LTF has no "expected iteration count" self-check, nothing detects the gap; `loopctl`/`loop-bench` would silently compute wrong convergence stats. | High |
| F3 | Two loop iterations (or two parallel agents from kit's "All (multi-agent)" mode, or a user manually re-running `claude` while a previous session's hook is still finishing) append to `trace.ltf.jsonl` concurrently. | a, c, d | JSONL is documented as "crash-safe" only in the sense that a truncated *file* is inspectable up to the truncation point (SPEC §1.1 principle 5) — it says nothing about atomicity of concurrent multi-process appends. `fs.appendFileSync`/O_APPEND writes are atomic per POSIX **only up to a filesystem-dependent limit** (historically discussed around `PIPE_BUF`-like guarantees for pipes; for regular files on local disk this is a practical-not-guaranteed convention on Linux/macOS, and explicitly **not** safe on some network filesystems). A bash `printf '%s\n' "$event" >> "$TRACE_FILE"` (as `ltf-hook.sh:236` does today) has the same exposure. For realistic single-line JSON events (a few hundred bytes to low KB) this is low-probability but not zero, especially under multi-agent mode which is a named kit feature. | Medium (High if multi-agent parallel loops become a supported combination with LTF) |
| F4 | Long-running loop (hundreds of iterations, or a loop with `max_iterations: unlimited` — which kit's wizard explicitly offers) produces a `trace.ltf.jsonl` that grows without bound. | all | `.loop/ltf.config.yaml` **already advertises** `retention: {max_entries: 1000, max_size_mb: 10}` (`src/generators/ltf-config.ts:18-21`) to the user, but nothing in the codebase reads or enforces this. This is a second instance of the same class of bug as the headline finding: kit ships a config promise with zero implementation behind it. If unaddressed, either (a) the file grows unbounded and the promise is simply false, or (b) someone naively truncates/rotates the file later without realizing `loop_id` continuity and `iterations_to_first_success` computations depend on the *whole* history being present in one place — truncating mid-loop silently breaks any consumer computing convergence metrics from that file. | High |
| F5 | `budget.yaml` also declares its own `ltf: {enabled: true, output: ".loop/trace.ltf.jsonl"}` block (`src/generators/budget.ts:23-26`), independent of `.loop/ltf.config.yaml`'s `output` field. | all | Two files claim to be the source of truth for where traces go. If a future feature (e.g. a `--output` override, or per-template trace paths) updates one and not the other, the writer and the reader could disagree about the file location with no error — `kit status` would report "no traces" while traces silently accumulate elsewhere, or vice versa. | Medium |
| F6 | Agent self-reports trace entries via free-form instruction in CLAUDE.md ("append a JSON line describing what you did"). | b (agent self-reporting) | LLMs reliably degrade at exact-format tasks under long context / after many turns — this is a well-documented failure mode, not a hypothetical. Concretely: (1) the agent may emit valid JSON but forget required fields (`phase`, `loop_id`) since nothing enforces the schema at generation time; (2) the agent may pretty-print the JSON (multi-line) because that's the "natural" way an LLM formats JSON when not given a hard constraint, violating SPEC §8's single-line requirement; (3) the agent may quote the JSON in a markdown code fence when writing a file via the `Write` tool, embedding backticks or explanatory prose adjacent to the JSON line; (4) the agent may simply forget to do it for several iterations in a row and then "catch up" by writing several summarized/fabricated lines at once with reconstructed (i.e., wrong) timestamps — this is the worst outcome because it's **not** structurally detectable (valid JSON, valid schema, wrong data) and pollutes cost/duration aggregates kit's own `status` command sums. | **Critical** for data integrity (not just format) |
| F7 | Malformed line from F6 (or any other cause) reaches `kit status`. | reader (`src/cli/status.ts:184-200`, already exists) | `readTraces()` already wraps `JSON.parse` per line in try/catch and silently drops unparseable lines (`status.ts:192-198`) — confirmed by reading the code. This means a systemic writer bug (e.g., every 5th line malformed due to a shell quoting bug) shows up to the user only as a slightly-lower-than-expected trace count, with **zero surfaced diagnostic**. `kit status` should distinguish "0 malformed lines" from "N lines silently dropped" — today it cannot, because the parse failure information is discarded (`catch { return null; }` with no logging). This masking behavior is a real bug in the *existing, already-shipped* reader, independent of which writer mechanism is chosen. | High |
| F8 | Helper subcommand (`kit trace append ...`) invoked once per tool call, potentially hundreds of times per loop, as a naive re-implementation of what `ltf-hook.sh`'s `PostToolUse` hook does today. | c | Kit is a `commander`-based CLI with `@clack/prompts` and other heavier deps loaded per `import`. Even a "thin" subcommand pays Node process cold-start cost (module resolution + V8 startup), realistically 50-150ms per invocation depending on machine/disk cache, dwarfing the few-ms cost of the bash+`jq` hook it would replace. At a few hundred tool calls per loop this is tens of seconds of pure overhead added to wall-clock loop time — directly work against kit's own pitch ("30 seconds to loop") and against tight iterative loops that call tools rapidly. This is a **real, measurable** cost, not speculative — it should be benchmarked before committing to this shape for high-frequency (per-tool-call) events. It is *not* a concern if the subcommand is only invoked once per iteration (e.g., from inside `verify.sh`, a few times per loop) rather than once per tool call. | High if used at per-tool-call frequency; Low if used at per-iteration frequency |
| F9 | Shell quoting/escaping bugs in a new bash-based writer, mirroring the exact bug class already fixed once in `hooks.ts` (`FINDINGS.md` #11: single-quote injection breaking the `echo` line) and once in the ltf project itself (`FINDINGS.md` #3: path-traversal via unsanitized `session_id`). | a, d (if hand-rolled rather than vendored) | Any new bash script that interpolates agent-controlled or verify-command strings into JSON via string concatenation (rather than `jq -cn --arg`, which is what the *existing* `ltf-hook.sh` correctly uses throughout) reintroduces exactly the bug class kit already paid down once. A verify command containing a double quote, backtick, or `$()`  substring would break naive `printf '{"detail":"%s"}' "$cmd"`-style JSON construction. | High if hand-rolled; Low if the existing `jq`-based adapter patterns are reused as-is |
| F10 | `jq` is not installed on the user's machine. | a, d | `ltf-hook.sh`'s own `main()` already handles this gracefully — `exit 0` if `jq` is absent (`ltf-hook.sh:282-284`), i.e., it fails silent-open (no trace, no crash). That is the *right* failure mode for a hook that must never break the user's actual work, but it directly contradicts kit's pitch of tracing "by default" — on a `jq`-less machine, kit would silently produce **zero** traces while still claiming (via `ltf.config.yaml`) that tracing is enabled. Kit's own dependency list (`package.json`) has no `jq` dependency and Node CLIs generally shouldn't assume external binaries. This needs an explicit decision (see §6) since it directly undermines the "by default" claim in the pitch doc for any writer path that depends on `jq`. | High |
| F11 | Process killed mid-write (`SIGKILL` on the shell or Node process between opening the file and completing the `write()` syscall for one line). | all | A single `write()`/`fs.appendFileSync()` call for a JSON blob under typical OS page-size thresholds (4KB) is very likely atomic in practice on local filesystems, but this is a convention, not a POSIX guarantee for regular files the way it is for pipes. Worst case: a partial line (e.g., `{"ltf_version":"1.0","loop_i`) is left with no trailing newline. Per SPEC §8 (line separator `\n`) this is not a valid final record. Verified against real tooling: the Go validator's `bufio.Scanner` will still yield the trailing partial content as a final "line" (scanners return content up to EOF even without a trailing newline) and it will correctly fail as "invalid JSON" (`validator.go:100-107`) — **this is a contained, single-line failure, not a whole-file failure**, which is good, but only if every writer always does exactly one line = one `write()` call and never buffers multiple lines before flushing. | Medium (contained) but must be verified with an actual kill-mid-write test, not just reasoned about |
| F12 | Backward compatibility: a project scaffolded with kit v0.1.0 (before this phase) has `.loop/ltf.config.yaml` and `.loop/budget.yaml` but no writer wiring, no `.claude/settings.json` hook registration, and possibly a hand-edited `verify.sh`. User upgrades kit and re-runs `kit init`. | all | Kit's own documented, accepted design (FINDINGS.md item #6: "Files overwritten on re-run" — ACCEPTED) means `kit init` will clobber `verify.sh`, `CLAUDE.md`, etc. on re-run. If the new mechanism requires inserting new content into `verify.sh` (option a) or `.claude/settings.json` (option d, which kit has never written to before), the plan must specify: does a second `kit init` run destroy user customizations to `verify.sh` made between v0.1.0 and now? Does it *merge* into `.claude/settings.json` (which may contain unrelated user hooks/permissions) or does it overwrite the whole file? Kit has **no JSON-merge capability today** — every existing generator does whole-file overwrite via `writeFileSafe`. Writing to `.claude/settings.json` naively would be the first case where kit's overwrite-by-default philosophy could destroy user configuration unrelated to loop scaffolding (permissions, other hooks, MCP config, etc.), which is qualitatively worse than overwriting kit's own generated files. | **Critical** if `.claude/settings.json` is touched without a merge strategy |
| F13 | A failed verification iteration (exit code ≠ 0) needs a trace line too, not just successful ones. | a, b, c | It's easy to design a "happy path" writer that only fires on success (e.g., only appends inside the `if [ $exit_code -eq 0 ]` branch of `hooks.ts`'s generated script). The current generated `verify.sh` (`src/generators/hooks.ts:15-20`) already branches on `$exit_code`, and both branches must append a `verify`-phase event with `result.status` set to `"success"` or `"fail"` respectively (or the `error`-phase/`exit_code` field) — otherwise failed iterations are invisible in the trace, which is precisely the case a loop-debugging tool (LoopReplay) most needs to see. | High |

---

## 3. Acceptance Criteria Checklist

This phase is **done** when all of the following are true, regardless of which mechanism (a/b/c/d/hybrid) is chosen:

- [ ] **AC1 — Schema validity.** Every line written to `.loop/trace.ltf.jsonl` by kit's own scaffolding, for both success and failure verification outcomes, passes `ltf validate` (or an equivalent JSON-Schema check against `ltf/spec/v1.0/schema.json`) with **zero errors**. Warnings are acceptable and should be enumerated/justified, not silently ignored.
- [ ] **AC2 — Required fields always present.** `ltf_version`, `loop_id`, `timestamp`, `phase` appear on every phase-event line; `loop_id` is stable across all events/summary of a single loop run; `iteration` (when present) is ≥ 1, never 0 (kit's internal 0-based `state.md` counter must be translated, not reused raw).
- [ ] **AC3 — Loop summary emitted.** At loop termination (success, failure/budget exhaustion, or max-iterations reached), exactly one `type:"loop_summary"` record is appended with a `termination_reason` that reflects the *actual* reason (not a hardcoded default), and it has no `phase` field.
- [ ] **AC4 — Append, never overwrite.** Re-running the loop, or any individual verification iteration, never truncates or rewrites prior lines in `trace.ltf.jsonl`. A regression test must assert file size only grows across iterations. (Direct mitigation for F1.)
- [ ] **AC5 — One `write()` per line.** The writer never buffers multiple JSONL records and flushes them together, and never uses a pretty-printed/multi-line `JSON.stringify`. Verified by a test that inspects raw byte output, not just re-parsed objects.
- [ ] **AC6 — Failure path traced.** A verification run that exits non-zero still produces a valid `verify`-phase (or `error`-phase) trace line with `result.status` reflecting failure and `verification.exit_code` set correctly — not just a silent skip. (Direct mitigation for F13.)
- [ ] **AC7 — Crash containment.** If the writing process is killed mid-append, the resulting file has at most one trailing malformed/partial line, and all prior lines remain valid and parseable. `kit status` and `ltf validate` must both demonstrate this (not just be reasoned about).
- [ ] **AC8 — No silent, total tracing failure.** If the chosen mechanism has an external dependency that can be absent (e.g., `jq`, a specific hook system), kit surfaces this to the user at `kit init` time (a wizard warning or a note in generated output) rather than silently producing zero traces while `ltf.config.yaml` claims tracing is enabled. (Direct mitigation for F10.)
- [ ] **AC9 — Retention promise reconciled.** `.loop/ltf.config.yaml`'s `retention: {max_entries, max_size_mb}` block is either (a) actually enforced by the writer, or (b) explicitly re-scoped in the generated config/docs as "advisory metadata for downstream consumers, not enforced by kit" — whichever is chosen, the code and the generated config text must agree. Silently doing neither (current state) is not acceptable to carry forward.
- [ ] **AC10 — Single source of truth for output path.** `budget.yaml`'s `ltf.output` and `ltf.config.yaml`'s `ltf.output` never disagree; ideally one is derived from / defers to the other, or one field is removed.
- [ ] **AC11 — No new whole-file-overwrite hazard.** If the mechanism writes to any file kit doesn't already fully own (most notably `.claude/settings.json`, which may contain user content unrelated to loop scaffolding), it merges rather than overwrites, with a test proving pre-existing unrelated keys survive a `kit init` re-run.
- [ ] **AC12 — Backward compatible re-scaffold.** Running the new `kit init` against a project previously scaffolded by the pre-Phase-1 kit (config files present, no writer wiring) adds the missing writer wiring without destroying user edits to files kit doesn't need to touch, and without duplicating hook registrations on repeated runs (idempotency).
- [ ] **AC13 — Reader/writer parity.** `src/cli/status.ts`'s `TraceEntry` interface and its consumption of `action`/`result` fields is corrected to match the real spec's object shapes (`action: {type, target, detail}`, `result: {status, detail, files_changed}`) rather than the current `string` typing — or an explicit note is added explaining why kit intentionally reads a narrower projection. (Direct mitigation for the headline finding's downstream effect on the reader.)
- [ ] **AC14 — Parse-failure visibility.** `readTraces()` (or its replacement) surfaces a count of lines that failed to parse (even just in verbose/status output), rather than the current unconditional silent drop, so a systemic writer bug is detectable by a user running `kit status`.
- [ ] **AC15 — Concurrency stance documented.** The plan explicitly states whether concurrent multi-agent loops writing to the same `trace.ltf.jsonl` are a supported scenario for v1.0. If yes, an append-atomicity strategy (single small `write()` calls, or a lock) is implemented and tested with an actual concurrent-write test (two processes appending N lines each, assert `2N` valid lines with no interleaved corruption). If no, this is documented as an explicit non-goal, not left ambiguous.
- [ ] **AC16 — Test suite includes an `ltf validate`-equivalent smoke test in CI.** Not just kit's own unit tests re-parsing its own output (which would validate self-consistency, not spec-compliance) — an independent schema check against `ltf/spec/v1.0/schema.json` or the real `ltf` CLI/parsers.

---

## 4. Test Matrix

| # | Test case | Setup / Input | Expected outcome |
|---|---|---|---|
| T1 | Happy path, 3 iterations | Scaffold a project, run 3 loop iterations where verification passes each time | `trace.ltf.jsonl` contains ≥3 `verify`-phase lines with `result.status:"success"`, `iteration` values 1,2,3 (or consistent iteration semantics per §9.3 of spec), all sharing one `loop_id`; ends with exactly one `loop_summary` line with `termination_reason` reflecting how the loop actually ended and `total_iterations: 3` |
| T2 | Failed verification iteration | Run 1 iteration where the verify command exits non-zero | A `verify`-phase (or `error`-phase) line is still written, `result.status:"fail"`, `verification.exit_code` matches the actual non-zero code; loop does not silently omit the line (mitigates F13) |
| T3 | Malformed/interrupted write | Send `SIGKILL` to the writing process immediately after it begins writing a trace line (e.g., via a test harness that races a kill against the append) | File contains N valid prior lines + at most 1 trailing incomplete/invalid line; `ltf validate` reports exactly that one line as invalid JSON and all others as valid (not a cascading failure); `kit status` still reports correct aggregates from the valid lines |
| T4 | Backward compatibility — pre-existing project | Take a project scaffolded by current kit v0.1.0 (config files exist, no writer), run the new `kit init` (or equivalent upgrade path) against it | Writer wiring is added; any existing `.loop/trace.ltf.jsonl` from manual/other tooling is preserved (not truncated); re-running `kit init` a second time does not duplicate hook registrations in `.claude/settings.json` (if that file is touched) |
| T5 | Overwrite safety | Call the writer/append path twice in immediate succession | File length after 2nd call = file length after 1st call + length of 2nd line; first line is byte-identical to what it was after call 1 (mitigates F1) |
| T6 | No pretty-printing / single line per record | Inspect raw file bytes after any write | Each record occupies exactly one line terminated by `\n`; no record spans multiple lines; `wc -l` matches event count |
| T7 | Required-field completeness | Parse every line produced across T1-T2 | Every phase-event line has non-null `ltf_version` matching `^1\.`, non-empty `loop_id`, valid ISO-8601 `timestamp`, `phase` in the closed enum; every summary line has `type:"loop_summary"`, no `phase`, and all 7 required summary fields |
| T8 | `iteration` numbering | Inspect `iteration` field across a multi-iteration run | Always ≥ 1 (never the 0 that kit's internal `state.md` iteration counter starts at); monotonically non-decreasing per the spec's iteration-boundary rule (§4.1/§9.3: increments on `act` following `verify`/`decide`) |
| T9 | `jq` (or other external dependency) absent | Run the full scaffold+loop flow in an environment without `jq` on PATH (if the chosen mechanism depends on it) | Kit either (a) still produces valid traces via a non-`jq` path, or (b) clearly surfaces a warning at `kit init` time that tracing will be degraded/disabled — it must NOT silently claim `ltf.enabled: true` while producing zero output (mitigates F10) |
| T10 | Retention config integrity | Generate `.loop/ltf.config.yaml`, inspect `retention` block, then run a loop long enough to exceed `max_entries` or `max_size_mb` | Either the file is rotated/truncated per policy with `loop_id` continuity preserved and documented semantics for what happens to old data, or the config explicitly no longer promises enforcement it doesn't do (mitigates F4/F9 in acceptance criteria terms — AC9) |
| T11 | `budget.yaml` / `ltf.config.yaml` output path agreement | Generate both files fresh | `budget.yaml`'s `ltf.output` value equals `ltf.config.yaml`'s `ltf.output` value byte-for-byte (mitigates F5) |
| T12 | Settings merge safety (only if `.claude/settings.json` is touched) | Pre-populate `.claude/settings.json` with an unrelated hook and a `permissions` block, then run `kit init` | Post-run file still contains the unrelated hook and permissions block unchanged, plus the new LTF-related hook entries added (not overwritten) (mitigates F12) |
| T13 | High-frequency invocation latency (only if a subcommand mechanism is chosen at per-tool-call granularity) | Benchmark N invocations of the subcommand in isolation (`time` loop of 100 calls) | Document actual measured per-call overhead; if it exceeds a stated budget (e.g., >20ms/call), this must be flagged as a blocking concern before shipping at that call frequency (mitigates F8) |
| T14 | Reader resilience to spec-shaped (object) `action`/`result` fields | Feed `kit status`'s trace reader a line with `action: {type:"file_edit", target:"x.ts"}` and `result: {status:"success"}` (i.e., real spec shape, not the current string-typed `TraceEntry`) | Reader does not crash and does not silently misinterpret the object as a string; ideally displays or aggregates it correctly (mitigates the type-mismatch in the headline finding) |
| T15 | Parse-failure visibility | Feed the trace file 10 valid lines + 3 deliberately malformed lines, run `kit status` | Output indicates 13 total lines processed and 3 that failed to parse (not just "10 entries" with the 3 silently vanishing) (mitigates F7 / AC14) |
| T16 | Concurrent writers (only if declared supported per AC15) | Spawn 2 processes each appending 50 lines to the same trace file concurrently | Resulting file has exactly 100 valid, parseable lines; no interleaved/corrupted lines (mitigates F3) |

---

## 5. Recommended Mechanism (independent opinion)

None of the four candidates as stated is sufficient alone. Recommend a **hybrid, tiered by
call frequency and by agent**:

**5.1 — For Claude Code (kit's primary/first-class agent target): adopt, don't reinvent, the
existing `ltf/adapters/claude-code` hook — but fix its two known soft spots before wiring it
into kit.**

The existing `ltf-hook.sh` + `install.sh` already does per-tool-call `PostToolUse` tracing with
correct phase inference, per-session `loop_id` state, and a `Stop`-hook `loop_summary`. It has
already absorbed the shell-quoting and path-traversal bug classes that this project's own
`FINDINGS.md` explicitly warns about repeating (jq's `--arg`/`-cn` usage throughout avoids the
exact single-quote-injection bug class kit fixed once in `hooks.ts`). Rather than have kit's
generator hand-write a second, less-tested bash/JSON emitter, kit's `generateAll()` should:

- Vendor (or npm-depend on) the adapter script, write it to `.loop/ltf-hook.sh` (mirroring
  `install.sh`'s behavior) at `kit init` time.
- **Merge**, not overwrite, `.claude/settings.json` to register the `PostToolUse`/`Stop` hooks —
  this is new capability kit doesn't have today (every current generator overwrites whole
  files) and must be built with idempotency and preservation of unrelated keys as first-class
  requirements (AC11/AC12, T12).
- At `kit init` time, detect whether `jq` is on PATH and, if not, warn the user explicitly in
  the CLI output (AC8) rather than silently shipping a hook that will `exit 0` forever.
- Treat the hardcoded `"user_cancelled"` termination reason in `handle_session_end` as a known,
  carried-over limitation, not a solved problem — fixing it (deriving the real reason from
  kit's own `state.md`/`budget.yaml` state at session end) is in-scope for this phase since kit,
  unlike the adapter's original design context, *has* that information available (max
  iterations, budget caps) and can pass it through.

**5.2 — For Codex / Gemini / Cursor (no equivalent per-tool-call hook infrastructure exists):
fall back to verify-hook-based tracing (mechanism a), scoped honestly.**

Since these agents don't expose anything like Claude Code's `PostToolUse` hook, the only
reliable, cross-agent integration point kit already has is the verification script it already
generates (`.loop/verify.sh` / `.claude/hooks/verify.sh`). Append exactly one `verify`-phase
event (success or failure, per T2/AC6) per verification run, plus a `loop_summary` when the
loop's own termination logic (budget/iteration cap) fires. This will produce a **coarser**
trace than the Claude Code path (no `plan`/`act` granularity, only `verify`/`terminate`) — that
tradeoff should be stated explicitly in kit's docs, not glossed over as equivalent fidelity.
The append itself should go through a small, dedicated, unit-tested Node function (not
ad hoc shell string concatenation) to avoid F9's bug class — this can be exposed as the internal
implementation behind a `kit trace append` subcommand (mechanism c), but invoked at most once or
twice per iteration (from inside `verify.sh`), where Node process-spawn latency (F8) is
negligible relative to the verification command itself (running a test suite already costs
seconds; one more Node startup costs tens of milliseconds).

**5.3 — Explicitly reject pure agent-self-reporting (mechanism b) as the *sole* mechanism.**

It may still be reasonable to have CLAUDE.md *mention* the trace file exists so the agent
doesn't get confused seeing it, but making trace fidelity depend on an LLM reliably producing
byte-exact single-line JSON on every iteration, especially over long sessions where instructions
degrade, is not an acceptable reliability bar for a feature kit markets as "by default." F6 is
the most severe failure mode in this document precisely because it's silent and
schema-plausible: a self-reporting agent that fabricates or drops entries produces data that
*passes validation* while being wrong, which is strictly worse than a mechanically-generated
trace with occasional gaps.

**5.4 — Pure `kit trace append` as a per-tool-call subcommand (mechanism c at high frequency)
is rejected** for the reason in F8/T13: it duplicates what the existing bash+jq adapter already
does cheaply, at higher latency cost, for no fidelity gain over adopting 5.1 as-is.

---

## 6. Risks and Unknowns Requiring a Human Decision

1. **Is multi-agent-parallel (kit's "All (multi-agent)" wizard option) meant to run agents
   concurrently against the same project, sharing one `trace.ltf.jsonl`?** If yes, AC15's
   concurrency-atomicity work is mandatory for v1.0, not a nice-to-have — this changes scope
   materially (locking or single-writer-process arbitration). If the "All" option actually means
   "generate configs for all agents but the user runs them one at a time," this risk is moot.
   The pitch doc doesn't resolve this either way.
2. **Does kit want a hard runtime dependency on `jq` (and therefore document it as a
   prerequisite, the way the `ltf` adapter's own README does), or does it want to stay
   dependency-free and reimplement the hook logic in Node?** These have very different latency
   (F8) and reliability (F10) profiles and this document should not be read as silently deciding
   this — §5 recommends `jq` for the high-frequency Claude Code path specifically because it's
   already proven at that call frequency, but this is a judgment call that trades a new external
   dependency for lower latency, and the human reviewer may weigh that differently.
3. **Should kit actually enforce the `retention` policy it already advertises (max_entries /
   max_size_mb), and if so, what happens to `loop_id` continuity and historical convergence
   metrics when old lines are dropped?** Rotating a JSONL trace file safely (without corrupting
   a line mid-rotation) is itself new engineering surface area with its own concurrency/atomicity
   questions, arguably a second phase's worth of work. A cheaper interim answer — explicitly
   re-labeling `retention` as advisory/aspirational in the generated config and docs — avoids
   scope creep but requires a conscious decision to (temporarily) under-deliver on the pitch doc.
4. **Termination-reason accuracy**: computing the *real* `termination_reason`
   (`goal_met` vs `budget_exhausted` vs `max_iterations` vs `stall_detected` vs `spin_detected`)
   requires kit's loop-runner logic to know *why* it stopped, which today lives implicitly in
   `state.md`/`budget.yaml` semantics kit itself defines but has no code that actively enforces
   or monitors (kit generates budget *configs*; nothing in the reviewed source actually reads
   `budget.yaml` at runtime to cut off a loop). If nothing currently enforces the budget, "how do
   we know why the loop ended" is an open architectural question that predates and is larger than
   this LTF phase — worth flagging to the human reviewer rather than assuming the other agent's
   plan has quietly solved it.
5. **Scope of `.claude/settings.json` merging**: this is the first time kit would need real JSON
   deep-merge semantics (as opposed to whole-file template generation). Should this be a new,
   independently-tested `utils/settings-merge.ts` module with its own unit tests (recommended),
   or a one-off inline `JSON.parse`/mutate/`JSON.stringify` in the generator (higher risk of
   silently dropping fields, similar in spirit to bug classes already found in `registry.ts`'s
   validation gaps per FINDINGS.md #4)? This deserves explicit design attention, not an
   afterthought bolted onto `generateAll()`.
6. **Should `kit status`'s `TraceEntry` type and display logic be corrected in this same phase**
   (AC13) or deferred? It's currently wrong relative to spec but not currently *visibly* broken
   (because it never renders `action`/`result` content, only aggregates numeric fields) — so it's
   a latent bug, not a live one, and reasonable people could scope it out of "Phase 1: make
   traces get written" and into a follow-up "Phase 1b: make status.ts spec-accurate." Recommend
   folding it in now since it's cheap and directly adjacent, but this is a scoping call for the
   human reviewer, not a unilateral decision this document should make.
7. **What is the actual measured Node cold-start cost for kit's CLI** (F8/T13)? This document
   reasons about it qualitatively; before finalizing mechanism 5.2's "negligible at per-iteration
   frequency" claim, someone should run `time node dist/cli.js trace append ...` a few dozen times
   on representative hardware and confirm the number, since "negligible" is currently an estimate,
   not a measurement.
