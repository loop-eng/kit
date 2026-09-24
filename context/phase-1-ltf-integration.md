# Phase 1 Plan: Real LTF Trace Emission

Status: proposal, not yet implemented. No source files were changed while researching or writing this document.

Scope: close the gap between what kit's pitch promises ("every scaffolded loop emits LTF traces by default") and what kit v0.1.0 actually ships (a config file describing where traces *would* go, and a reader for a file nothing ever writes).

---

## 1. Problem Statement

Kit generates five files under `.loop/` today (`src/generators/index.ts:25-76`): `verify.sh`, `goal.md`, `budget.yaml`, `ltf.config.yaml`, `state.md`. None of the code paths that run *after* scaffolding — the generated `verify.sh`, or any part of the agent's own loop — ever write a line to `.loop/trace.ltf.jsonl`. Concretely:

- `src/generators/ltf-config.ts:1-26` emits `.loop/ltf.config.yaml`, a YAML file that *describes* an intended output (`output: ".loop/trace.ltf.jsonl"`) and a set of fields kit claims it records (`timestamp`, `iteration`, `action`, `result`, `cost_usd`, `tokens`, `duration_ms`) and a retention policy (`max_entries: 1000`, `max_size_mb: 10`). This is pure documentation — nothing reads this file at runtime, and nothing enforces the retention policy it advertises.
- `src/generators/hooks.ts:1-22` generates `.loop/verify.sh` (and, for `claude-code`/`cursor`, a copy at `.claude/hooks/verify.sh`). It runs the verification command, prints pass/fail, and exits with the command's exit code. It has zero trace-emission logic.
- `src/generators/index.ts:25-76` (`generateAll`) writes all the files above and calls `ensureGitignore(dir, [".loop/state.md", ".loop/trace.ltf.jsonl"])` (line 73) — kit already *anticipates* a trace file will exist (enough to gitignore it) but never creates the code that produces it.
- `src/cli/status.ts:184-200` (`readTraces`) reads and parses `.loop/trace.ltf.jsonl` if present, and `src/cli/status.ts:19-27` defines a `TraceEntry` shape kit believes the file will contain — flat `cost_usd`, `tokens` (typed as a bare `number`), `duration_ms`. This reader has simply never had real input in the wild.
- `demo/test_e2e.sh:154-157` ("Test 6: Status command") only asserts on `state.md`/`budget.yaml`-derived output ("not_started", "Cost cap"). It never asserts anything about a "Traces:" line, because no test in the suite ever populates `trace.ltf.jsonl`. The reader code is effectively untested end-to-end.
- The pitch document, `ideas/04-kit.md:46`, lists "LTF trace integration — every scaffolded loop emits LTF traces by default" as one of six core value props, and the wizard demo output at line 90 shows `.loop/ltf.config.yaml` as the "LTF" deliverable — conflating "config that describes tracing" with "tracing."

Kit is a one-shot CLI: `generateAll` runs once, writes files, and the process exits. The agent loop that follows (Claude Code, Codex CLI, Gemini CLI, or a human driving Cursor) runs completely outside kit's process lifetime. Kit cannot observe it directly. Any real fix has to inject trace-writing into something that *does* run during the loop — the generated `verify.sh`, or the agent's own behavior, or both.

## 2. LTF Format Research Findings

Source: `/Users/rfirke/Downloads/AI Projects/Loop Engineering/ltf` (sibling repo, own git history, own GitHub remote `loop-eng/ltf`, currently unpublished — see below).

### 2.1 Schema (spec/v1.0/SPEC.md, spec/v1.0/schema.json)

Two record shapes live in the same `.ltf.jsonl` file, discriminated by the presence of `"type":"loop_summary"`:

**Phase event** — only 4 fields required: `ltf_version`, `loop_id`, `timestamp`, `phase` (`plan|act|verify|decide|error|terminate`). Everything else is optional: `event_id`, `session_id`, `iteration` (1-indexed), `agent{name,role,provider}`, `action{type,target,detail}`, `tokens{input,output,cached,cache_write}`, `cost_usd`, `duration_ms`, `context{window_used,window_max,fill_pct}`, `result{status,detail,files_changed}`, `verification{command,exit_code,output_summary}`, `metadata{}`.

Real example from the README:
```jsonl
{"ltf_version":"1.0","loop_id":"abc-123","timestamp":"2026-07-01T10:00:00Z","phase":"act","iteration":1,"agent":{"name":"claude-sonnet-4-6","role":"implementer"},"action":{"type":"file_edit","target":"src/auth.ts"},"tokens":{"input":8000,"output":400},"cost_usd":0.030}
{"ltf_version":"1.0","loop_id":"abc-123","timestamp":"2026-07-01T10:00:12Z","phase":"verify","iteration":1,"action":{"type":"test_run","target":"npm test"},"verification":{"command":"npm test","exit_code":0},"result":{"status":"success"}}
{"ltf_version":"1.0","loop_id":"abc-123","timestamp":"2026-07-01T10:00:12Z","phase":"terminate","result":{"status":"success","detail":"goal_met"}}
```

**Loop summary** — emitted once at loop end, 7 required fields: `ltf_version`, `type:"loop_summary"`, `loop_id`, `started_at`, `ended_at`, `total_iterations`, `termination_reason` (`goal_met|budget_exhausted|max_iterations|user_cancelled|error|spin_detected|stall_detected`). Optional: `total_tokens{}`, `total_cost_usd`, `total_duration_ms`, `convergence{iterations_to_first_success,verification_pass_rate,drift_score}`, `files_changed[]`, `tests{passed,failed,added}`.

Design principles worth inheriting (SPEC.md §1.1): additive-only evolution, tolerant-reader pattern (ignore unknown fields, default missing optional ones), every record self-describes its `ltf_version`.

**Important mismatch found**: kit's own `status.ts:19-27` models `tokens` as a bare number and treats `cost_usd`/`duration_ms`/`iteration` as flat per-event fields with no notion of a `loop_summary` record at all. If kit ever received real LTF-conformant input today, `readTraces()` would silently misparse the nested `tokens` object (`t.tokens ?? 0` on an object is `NaN`-safe only because it's never hit — `(sum, t) => sum + (t.tokens ?? 0)` would produce `NaN` the moment a real object appeared). This needs fixing regardless of which trace-writing approach is chosen.

### 2.2 Is there a package kit can depend on?

`parsers/typescript/package.json` declares `"name": "@loop-eng/ltf"`, `"version": "1.0.0"`, with a real `LTFWriter` class in `write.ts` (`.event(phase, data)`, `.summary(overrides)`, both already handling the loop_id/timestamp/version bookkeeping kit would otherwise reinvent) and a functional-style `emitEvent()` helper. This is exactly the writer kit's problem statement asks about.

**However**: I confirmed via `npm view @loop-eng/ltf` that the package returns **404 Not Found** on the public npm registry. The README's npm/PyPI version badges are aspirational — the repo has a GitHub remote and CI config but has never been published. Kit cannot take a runtime `npm install @loop-eng/ltf` dependency today without either (a) publishing ltf first, or (b) vendoring source, which creates a maintenance fork of a project that just went through 70 bug-hunt findings (`ltf/FINDINGS.md`) — forking it means kit would not benefit from any future fixes unless someone manually re-syncs.

### 2.3 Does ltf already solve "how do you trace a one-shot tool's downstream loop"?

Yes — and this is the most important finding. `ltf/adapters/claude-code/` is a **complete, tested (34 bash tests via `test-hook.sh`) solution** to exactly kit's problem, but scoped to Claude Code only:

- `install.sh` copies `ltf-hook.sh` into `.loop/` and registers it as a `PostToolUse` **and** `Stop` hook in `.claude/settings.json` (Claude Code's own hook system — a mechanism kit does not currently touch at all; kit only ever writes to `.claude/hooks/verify.sh`, a file the agent has to be told to run, not a file Claude Code invokes automatically).
- `ltf-hook.sh` (340 lines) receives Claude Code's PostToolUse JSON payload on stdin, classifies each tool call into a phase (`Edit/Write/NotebookEdit` → `act`/`file_edit`; test-shaped `Bash` commands → `verify`/`test_run`; `TodoWrite` → `plan`; everything else → `act`), tracks iteration boundaries per SPEC.md §9.3 (increment when `act` follows `verify`/`decide`), and appends one JSON line per tool call plus a `loop_summary` on `Stop`.
- It requires **`jq`** on PATH (hard dependency, not bundled) and is **Claude-Code-specific** — it reads Claude Code's exact hook payload shape (`session_id`, `tool_name`, `tool_input`, `tool_response`). It has no equivalent for Codex CLI, Gemini CLI, or a human driving Cursor.
- Crucially, even this adapter — which sits *inside* the agent's tool-call stream, far more privileged than anything kit's own `verify.sh` can see — **does not capture `cost_usd` or `tokens`**. Claude Code's PostToolUse hook payload doesn't expose token/cost accounting, so `ltf-hook.sh` never populates those fields either. This directly confirms the task's framing: real cost/token data is only available from the agent's own model-call accounting, which no external hook (kit's or ltf's) can observe.

This finding directly shapes the recommendation in §3: kit should not try to out-build this adapter for Phase 1, but it also can't adopt it as-is (unpublished dependency, jq requirement, single-agent scope).

## 3. Recommended Approach

**Primary mechanism: Approach 1 (verify-hook-based tracing), implemented as self-contained Bash embedded directly in kit's generated `verify.sh` — no `jq`, no Node, no `kit` binary, and no network access required at trace-write time.**

### Why not the others, for Phase 1

- **Approach 2 (agent self-reports via CLAUDE.md instructions)** is rejected as the *primary* mechanism. It's the only path to real `cost_usd`/`tokens` data, but it means the JSONL formatting logic is authored by the LLM at generation time with no test coverage — one malformed line (unescaped quote, truncated output, wrong field name) silently corrupts the trace file for every downstream consumer (`kit status`, `ltf validate`, Loop-Bench). Kit's whole differentiator is *verified, tested* scaffolding; shipping a mechanism whose core correctness property is "hope the LLM writes valid JSON" cuts against that. It is kept as an **optional, explicitly best-effort** addition (see §4, step 6) — never load-bearing.
- **Approach 3 (`kit trace append` subcommand)** is rejected as the mechanism `verify.sh` calls at runtime, for a structural reason specific to how kit is distributed: kit is normally invoked once via `npx @loop-eng/kit init` and then the process — and usually the ephemeral npx-installed copy — is gone. `verify.sh` may run minutes, hours, or days later, in a shell that has no guarantee `kit` (or even Node, for a Go/Python/Rust project) is on PATH or resolvable via `npx` without a network round-trip. Making the trace-emission path depend on `kit` being re-fetched from npm on every single verification run is fragile in exactly the way `verify.sh` (which must "always work") cannot afford to be. The formatting-logic-lives-in-one-place benefit this approach is chasing is achieved instead by generating the bash from a single, unit-tested TypeScript template function (`generateHooks`) — the logic is authored once, in TypeScript, with real tests; it just renders to bash instead of shelling out to bash.
- **Approach 4 (integrate the external `ltf` tool/adapter)** is rejected for Phase 1 because `@loop-eng/ltf` is unpublished (§2.2) and the one component that already solves this well, the Claude Code adapter, requires `jq` and is single-agent. It is called out explicitly in §9 as a strong Phase 2/3 candidate once `ltf` publishes — kit's hand-rolled writer is designed to stay schema-compatible (§2.1) specifically so migrating to `@loop-eng/ltf`'s `LTFWriter` later is a drop-in swap, not a format migration.

### What WILL be captured

- One `verify`-phase event per `verify.sh` invocation: `ltf_version`, `loop_id` (stable for the life of the project, persisted locally), `timestamp`, `phase:"verify"`, `iteration` (self-counted by the tracer — see §9.3 for why this is a separate counter from the agent-maintained one in `state.md`), `action{type:"test_run",target:<verify command>}`, `verification{command,exit_code}`, `duration_ms` (best-effort; see the portability note in §4), `result{status:"success"|"fail"}`.
- On the first passing run: an additional `terminate` event (`result.status:"success"`, implied `goal_met`) and one `loop_summary` record (`total_iterations`, `total_duration_ms`, `termination_reason:"goal_met"`).
- This works identically for all four agent targets (`claude-code`, `codex`, `gemini`, `cursor`) because it lives in the generated `verify.sh`/`.claude/hooks/verify.sh`, which every template already generates regardless of agent — no per-agent integration work needed.

### What WON'T be captured (be explicit about this with users)

- **`cost_usd` and `tokens`** — kit's `verify.sh` has no visibility into the agent's model calls, full stop. This is the same limitation the *far more privileged* Claude-Code-specific `ltf-hook.sh` adapter has (§2.3), so it isn't a compromise unique to kit's approach — it's a hard ceiling imposed by where the observation point sits.
- **`plan`/`act`/`decide`/`error` phase events** — only verification runs are visible to `verify.sh`. File edits, searches, intermediate shell commands, and the agent's internal reasoning between verification runs are invisible. A trace produced by this mechanism looks like "verify, verify, verify, terminate" — sparse compared to the rich per-tool-call trace `ltf-hook.sh` produces for Claude Code.
- **`agent{name,role,provider}`**, **`files_changed`**, **`context{}`** (context window usage), **`convergence.drift_score`** — none of these are observable from a bash script that only wraps the verification command.
- **Non-`goal_met` termination reasons** (`budget_exhausted`, `max_iterations`, `user_cancelled`, `stall_detected`) — `verify.sh` only runs when the agent chooses to run it. If the agent gives up, runs out of budget, or is killed, `verify.sh` never fires again and no `terminate`/`loop_summary` is ever written; the trace file simply stops mid-loop on the last `fail` event. Closing this gap needs a supervising process that outlives individual verify calls (the not-yet-built `kit run`, referenced in the original architecture doc but absent from `src/cli/` today) — out of scope for Phase 1, flagged in §9.

## 4. Detailed Implementation Steps

### Step 0 — new shared constants module

**New file**: `src/utils/ltf-paths.ts`
```ts
export const LTF_TRACE_PATH = ".loop/trace.ltf.jsonl";
export const LTF_STATE_PATH = ".loop/.ltf-state.json";
export const LTF_VERSION = "1.0";
```
Reason: `.loop/trace.ltf.jsonl` is currently a duplicated string literal in `ltf-config.ts:7`, `status.ts:185`, and `index.ts:73`. Centralizing it avoids a fourth (and now runtime-critical, since bash must embed the same path) copy drifting out of sync.

### Step 1 — rewrite `src/generators/hooks.ts`

Change `generateHooks(verifyCommand: string): string` to embed trace emission. Key design points, addressed individually below:

1. **JSON-safe embedding of the verify command.** The verify command is a compile-time constant at generation time (it's already resolved and interpolated today, `hooks.ts:11`). Rather than re-escaping it at bash runtime (which would need `jq` or careful hand-rolled escaping of arbitrary user-supplied "custom command" text), escape it **once**, at generation time, in TypeScript, using `JSON.stringify`, then embed the result as a single-quoted Bash variable assignment (reusing the existing `'\''`-style trick already used for the `echo` line at `hooks.ts:2`):
   ```ts
   const shellEchoEscaped = verifyCommand.replace(/'/g, "'\\''"); // existing
   const jsonEscaped = JSON.stringify(verifyCommand).replace(/'/g, "'\\''"); // new
   ```
   `jsonEscaped` is a *bash-literal-safe* embedding of a *JSON-string-safe* value (surrounding quotes included). At runtime it's assigned as `VERIFY_CMD_JSON='${jsonEscaped}'` and only ever consumed via `printf '%s' "$VERIFY_CMD_JSON"` — i.e., substituted as a `%s` **argument**, never spliced into the *format string* itself. This matters: if the command contained a literal `%` (e.g. a custom command like `printf '%s' foo && npm test`), splicing it into the format string would corrupt or crash `printf`. Passing it as an argument sidesteps that entirely.

2. **Portable millisecond timing.** `date +%s%3N` (GNU/Linux) prints milliseconds; on macOS's BSD `date` it does not support `%N` and silently prints the literal letter `N` appended to the epoch seconds (verified empirically: `date +%s%3N` on this machine's Darwin returns `17851734283N`). That breaks bash arithmetic (`$(( end - start ))` on a non-numeric string errors under `set -u`/`set -e` semantics used elsewhere in this script). Guard with a portable helper:
   ```bash
   now_ms() {
     local raw
     raw=$(date +%s%3N 2>/dev/null || true)
     if [[ "$raw" =~ ^[0-9]+$ ]]; then
       printf '%s' "$raw"
     else
       printf '%s' "$(( $(date +%s) * 1000 ))"
     fi
   }
   ```
   On macOS this degrades to whole-second precision (multiples of 1000ms) — document this as a known limitation (§8), don't try to paper over it.

3. **Loop identity + iteration counter, persisted outside `state.md`.** `state.md`'s iteration counter (`src/generators/index.ts:122-134`) is updated by the *agent*, per the loop protocol's step 4 (`claude-md.ts:26-32`) — and it's updated *after* `verify.sh` runs, not before, so `verify.sh` cannot read it as "the current iteration" without an off-by-one. Rather than depend on agent compliance with a specific update-ordering, the tracer keeps its own tiny state file at `LTF_STATE_PATH` (`.loop/.ltf-state.json`) with shape `{"loop_id":"...","started_at":"...","iteration":N,"total_duration_ms":N}`, created on first run and incremented on every `verify.sh` invocation. This is a **different, independently-meaningful counter** ("number of verification attempts") from `state.md`'s agent-reported iteration — see §9 for the tradeoff this creates and why it was chosen anyway.
   No `jq` needed to read/update this 4-field flat JSON object — plain `grep -o`/`cut` is sufficient and portable (BSD and GNU grep both support `-o`).

4. **Never block verification on trace-writing failure.** All trace-writing is wrapped so a disk-full condition, permissions issue, or unexpected edge case degrades to "no trace, verification still ran and exit code is still correct" rather than breaking the loop.

Proposed full contents:

```ts
import { LTF_TRACE_PATH, LTF_STATE_PATH, LTF_VERSION } from "../utils/ltf-paths.js";

export function generateHooks(verifyCommand: string): string {
  const shellEchoEscaped = verifyCommand.replace(/'/g, "'\\''");
  const jsonEscaped = JSON.stringify(verifyCommand).replace(/'/g, "'\\''");

  return `#!/usr/bin/env bash
set -uo pipefail

# Verification gate — runs after each agent iteration
# Generated by @loop-eng/kit

LOOP_DIR="$(cd "$(dirname "$0")" >/dev/null 2>&1 && pwd)"
[ -d "$LOOP_DIR" ] || LOOP_DIR="."
TRACE_FILE="$LOOP_DIR/../${LTF_TRACE_PATH##*/.loop/}"
# Resolve relative to the nearest .loop directory, wherever this copy of the
# script lives (.loop/verify.sh or .claude/hooks/verify.sh).
case "$LOOP_DIR" in
  */.loop) TRACE_ROOT="$LOOP_DIR" ;;
  *) TRACE_ROOT="$(cd "$LOOP_DIR/../../.loop" 2>/dev/null && pwd || echo "$LOOP_DIR")" ;;
esac
mkdir -p "$TRACE_ROOT" 2>/dev/null || true
TRACE_FILE="$TRACE_ROOT/trace.ltf.jsonl"
STATE_FILE="$TRACE_ROOT/.ltf-state.json"
VERIFY_CMD_JSON='${jsonEscaped}'

now_ms() {
  local raw
  raw=$(date +%s%3N 2>/dev/null || true)
  if [[ "$raw" =~ ^[0-9]+$ ]]; then
    printf '%s' "$raw"
  else
    printf '%s' "$(( $(date +%s) * 1000 ))"
  fi
}

echo 'Running verification: ${shellEchoEscaped}'

start_ms=$(now_ms)
set +e
${verifyCommand}
exit_code=$?
set -e
end_ms=$(now_ms)
duration_ms=$(( end_ms - start_ms ))

if [ "$exit_code" -eq 0 ]; then
  echo "✓ Verification passed"
  result_status="success"
else
  echo "✗ Verification failed (exit code: $exit_code)"
  result_status="fail"
fi

# --- LTF trace emission (best-effort; never blocks verification) ---
{
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  if [ ! -f "$STATE_FILE" ]; then
    new_loop_id=$(command -v uuidgen >/dev/null 2>&1 && uuidgen | tr '[:upper:]' '[:lower:]' || printf '%s-%s' "$(date +%s)" "$$")
    printf '{"loop_id":"%s","started_at":"%s","iteration":0,"total_duration_ms":0}' "$new_loop_id" "$timestamp" > "$STATE_FILE"
  fi

  state_content=$(cat "$STATE_FILE")
  loop_id=$(printf '%s' "$state_content" | grep -o '"loop_id":"[^"]*"' | cut -d'"' -f4)
  started_at=$(printf '%s' "$state_content" | grep -o '"started_at":"[^"]*"' | cut -d'"' -f4)
  iteration=$(printf '%s' "$state_content" | grep -o '"iteration":[0-9]*' | grep -o '[0-9]*$')
  total_duration_ms=$(printf '%s' "$state_content" | grep -o '"total_duration_ms":[0-9]*' | grep -o '[0-9]*$')
  iteration=$(( iteration + 1 ))
  total_duration_ms=$(( total_duration_ms + duration_ms ))

  printf '{"loop_id":"%s","started_at":"%s","iteration":%d,"total_duration_ms":%d}' \\
    "$loop_id" "$started_at" "$iteration" "$total_duration_ms" > "$STATE_FILE"

  printf '{"ltf_version":"${LTF_VERSION}","loop_id":"%s","timestamp":"%s","phase":"verify","iteration":%d,"action":{"type":"test_run","target":%s},"verification":{"command":%s,"exit_code":%d},"duration_ms":%d,"result":{"status":"%s"}}\\n' \\
    "$loop_id" "$timestamp" "$iteration" "$VERIFY_CMD_JSON" "$VERIFY_CMD_JSON" "$exit_code" "$duration_ms" "$result_status" >> "$TRACE_FILE"

  if [ "$result_status" = "success" ]; then
    printf '{"ltf_version":"${LTF_VERSION}","loop_id":"%s","timestamp":"%s","phase":"terminate","result":{"status":"success","detail":"goal_met"}}\\n' \\
      "$loop_id" "$timestamp" >> "$TRACE_FILE"
    printf '{"ltf_version":"${LTF_VERSION}","type":"loop_summary","loop_id":"%s","started_at":"%s","ended_at":"%s","total_iterations":%d,"total_duration_ms":%d,"termination_reason":"goal_met"}\\n' \\
      "$loop_id" "$started_at" "$timestamp" "$iteration" "$total_duration_ms" >> "$TRACE_FILE"
  fi
} 2>/dev/null || true

exit "$exit_code"
`;
}
```

(The `TRACE_ROOT` resolution above handles the fact that this same generated content is written to two different locations — `.loop/verify.sh` and `.claude/hooks/verify.sh` — and both need to converge on the *same* `.loop/trace.ltf.jsonl`, not a `.loop/` relative to `.claude/hooks/`. This needs careful manual testing against both real paths kit already writes to in `index.ts:36-46`; treat the exact path-resolution snippet above as a sketch to be verified against a real checkout, not copy-paste-final.)

### Step 2 — `src/generators/ltf-config.ts`

Update the generated `.loop/ltf.config.yaml` so it stops overclaiming:
- Replace the flat `fields: {timestamp: true, ...}` block (which doesn't correspond to the real nested schema and was never validated against `spec/v1.0/schema.json`) with a short comment block pointing at the LTF v1.0 spec and stating plainly which phases/fields are actually populated by the generated `verify.sh` (verify + terminate + loop_summary only — see §3's "WON'T capture" list).
- Keep `retention: {max_entries, max_size_mb}` but add a comment that retention is **advisory only** — nothing in Phase 1 truncates or rotates the file. (Enforcing it is a real feature with real risk of corrupting the file mid-write; deferred, see §9.)
- Import `LTF_TRACE_PATH`, `LTF_VERSION` from `../utils/ltf-paths.js` instead of hardcoding.

### Step 3 — `src/generators/index.ts`

- Add `LTF_STATE_PATH` to the `ensureGitignore` call (line 73) so `.loop/.ltf-state.json` doesn't get committed: `ensureGitignore(dir, [".loop/state.md", LTF_TRACE_PATH, LTF_STATE_PATH])`.
- No other changes needed — `generateHooks(verifyCommand)` is already called once and its output written to both `.loop/verify.sh` and `.claude/hooks/verify.sh` (lines 34-46), so both copies automatically gain tracing without touching this orchestration logic further.

### Step 4 — `src/cli/status.ts`

Fix the schema mismatch identified in §2.1 and add real trace-reading behavior:
```ts
interface TraceEvent {
  ltf_version?: string;
  loop_id?: string;
  timestamp?: string;
  phase?: "plan" | "act" | "verify" | "decide" | "error" | "terminate";
  iteration?: number;
  action?: { type?: string; target?: string; detail?: string };
  tokens?: { input?: number; output?: number; cached?: number; cache_write?: number };
  cost_usd?: number;
  duration_ms?: number;
  result?: { status?: string; detail?: string; files_changed?: string[] };
  verification?: { command?: string; exit_code?: number; output_summary?: string };
}

interface LoopSummary {
  type: "loop_summary";
  loop_id?: string;
  started_at?: string;
  ended_at?: string;
  total_iterations?: number;
  total_tokens?: { input?: number; output?: number; cached?: number; cache_write?: number };
  total_cost_usd?: number;
  total_duration_ms?: number;
  termination_reason?: string;
}

type TraceRecord = TraceEvent | LoopSummary;
function isLoopSummary(r: TraceRecord): r is LoopSummary { return (r as LoopSummary).type === "loop_summary"; }
```
`readTraces()` returns `TraceRecord[]` unchanged in structure (still tolerant of malformed lines, `status.ts:192-199`), but the aggregation logic in the `.action()` handler changes: **prefer the most recent `loop_summary` record's `total_cost_usd`/`total_tokens`/`total_duration_ms`/`total_iterations` if one exists; otherwise fall back to summing the raw `verify`/`act` events' `cost_usd`, `tokens.input + tokens.output`, and `duration_ms`.** This mirrors a fix ltf's own Go CLI needed (`ltf/FINDINGS.md` item #67: "`stats` command panics when `loop_summary` lacks convergence — no fallback to event-based computation") — same shape of bug, worth avoiding proactively rather than discovering it the same way they did.

### Step 5 — shared path constants used consistently

Update `ltf-config.ts`, `status.ts`, and `index.ts` to import from `src/utils/ltf-paths.ts` (Step 0) instead of repeating the `.loop/trace.ltf.jsonl` string literal.

### Step 6 (optional, low priority — can ship without it) — agent instruction note

Add one short paragraph to `claude-md.ts`, `codex-md.ts`, `gemini-md.ts` (and the `.cursorrules` path, which reuses `generateClaudeMd`) directly after the "Loop Protocol" section:
```
## Telemetry
Running the verification command automatically appends an LTF trace event
to `.loop/trace.ltf.jsonl` — do not edit this file directly. If you have
visibility into your own token usage or cost for this iteration, you may
optionally append an additional LTF `act`-phase JSON line following the
schema at https://github.com/loop-eng/ltf/blob/main/spec/v1.0/SPEC.md.
This is best-effort and not required.
```
This is Approach 2, demoted to a strictly optional enrichment layered on top of the tested Approach 1 baseline — never a dependency for the trace file to be useful. Cut this step first if the phase needs to be trimmed for time.

## 5. New/Changed Generated Output

**Before** (current v0.1.0 behavior after 3 loop iterations): `.loop/trace.ltf.jsonl` does not exist. `kit status` silently skips its entire "Traces:" block (`status.ts:98` — `if (traces.length > 0)` is always false).

**After**, for a loop where iteration 1 and 2 fail verification and iteration 3 passes:
```jsonl
{"ltf_version":"1.0","loop_id":"a1b2c3d4-e5f6-47a8-9b0c-1d2e3f4a5b6c","timestamp":"2026-07-27T18:02:11Z","phase":"verify","iteration":1,"action":{"type":"test_run","target":"npx vitest run"},"verification":{"command":"npx vitest run","exit_code":1},"duration_ms":4230,"result":{"status":"fail"}}
{"ltf_version":"1.0","loop_id":"a1b2c3d4-e5f6-47a8-9b0c-1d2e3f4a5b6c","timestamp":"2026-07-27T18:05:47Z","phase":"verify","iteration":2,"action":{"type":"test_run","target":"npx vitest run"},"verification":{"command":"npx vitest run","exit_code":1},"duration_ms":3810,"result":{"status":"fail"}}
{"ltf_version":"1.0","loop_id":"a1b2c3d4-e5f6-47a8-9b0c-1d2e3f4a5b6c","timestamp":"2026-07-27T18:09:02Z","phase":"verify","iteration":3,"action":{"type":"test_run","target":"npx vitest run"},"verification":{"command":"npx vitest run","exit_code":0},"duration_ms":3990,"result":{"status":"success"}}
{"ltf_version":"1.0","loop_id":"a1b2c3d4-e5f6-47a8-9b0c-1d2e3f4a5b6c","timestamp":"2026-07-27T18:09:02Z","phase":"terminate","result":{"status":"success","detail":"goal_met"}}
{"ltf_version":"1.0","type":"loop_summary","loop_id":"a1b2c3d4-e5f6-47a8-9b0c-1d2e3f4a5b6c","started_at":"2026-07-27T18:02:11Z","ended_at":"2026-07-27T18:09:02Z","total_iterations":3,"total_duration_ms":12030,"termination_reason":"goal_met"}
```
Note the absence of `cost_usd`/`tokens`/`agent` anywhere — consistent with §3's explicit scope. `kit status` would now show a real, non-empty "Traces: 5 entries" block with "Duration: 12.0s" (derived from the `loop_summary`), and no "Spent"/"Tokens" lines (correctly omitted since `totalCost`/`totalTokens` are 0).

## 6. Testing Strategy

**Unit tests (vitest):**
- `src/generators/__tests__/hooks.test.ts` (new): given a verify command, assert the generated script contains the trace-emission block; assert commands containing a single quote (`it's a test`) and a literal `%` (`printf '%s' x && npm test`) still produce a script that, when actually executed via `child_process.spawnSync` in a temp dir with `bash`, appends a line to `trace.ltf.jsonl` that survives `JSON.parse()` without throwing.
- Extend the above into a small integration-style suite that runs the generated `.loop/verify.sh` twice in the same temp dir (`exit 1` then `exit 0` as the "verify command") and asserts: `loop_id` is identical across both lines; `iteration` is `1` then `2`; the second run additionally appends `terminate` + `loop_summary` lines; `total_iterations` in the summary equals `2`.
- `src/cli/__tests__/status.test.ts` (new — no test file for `status.ts` exists today): covers the updated `TraceEvent`/`LoopSummary` union — nested `tokens` object summed correctly, `loop_summary` preferred over summed raw events when both are present, fallback-to-summing when only raw events exist, and existing malformed-line tolerance preserved.
- `src/generators/__tests__/generators.test.ts`: add an assertion to the existing "generates hook script with verify command" test that the script also contains `trace.ltf.jsonl` and `loop_summary` string literals, so a future accidental revert is caught by the fast unit suite, not just E2E.

**E2E tests (`demo/test_e2e.sh`)**, new numbered block after the existing 11:
- **Test 12 — LTF trace emission (pass path)**: new temp dir with `package.json` test script `"exit 0"` (deterministic, no real test runner needed); `kit init --yes`; directly invoke `.loop/verify.sh`; assert `.loop/trace.ltf.jsonl` exists, contains a `"phase":"verify"` line and a `"type":"loop_summary"` line, and every line parses as JSON (`node -e "JSON.parse(require('fs').readFileSync(...))"` per line, or `jq empty` if the CI image has it — prefer the Node one-liner to avoid adding a `jq` dependency to kit's own test tooling, which would be an ironic regression given §3's rationale).
- **Test 13 — LTF trace emission (fail path)**: same but `"exit 1"` test script; assert exactly one line, `"result":{"status":"fail"}`, and no `loop_summary` line.
- **Test 14 — iteration + loop_id continuity**: run `.loop/verify.sh` three times in the same dir (toggle the test script between runs); assert `loop_id` is byte-identical across all resulting lines and `iteration` values are `1,2,3` in file order.
- **Test 15 — `kit status` reflects real traces**: after Test 12's run, `kit status --dir <T12>` output contains "Traces:" and "Duration:" (currently impossible to assert — no test today ever populates the file this command reads).
- Update Test 9 (gitignore) to also assert `.loop/.ltf-state.json` is present in `.gitignore`.

**Platform coverage gap to flag**: `ci.yml` only runs `ubuntu-latest` (confirmed by reading `.github/workflows/ci.yml`). The BSD-`date` portability issue this plan works around (§4, step 1.2) was found by running `date +%s%3N` locally on this machine (Darwin) and observing a literal trailing `N` — **this would never be caught by current CI**, which only ever exercises GNU `date`. Recommend adding a `macos-latest` leg to the CI matrix (at least for the `npm run test` step, not necessarily lint/build) as part of this phase, or, failing that, a unit test that stubs `date` to return BSD-shaped output and asserts `now_ms()`'s fallback branch activates correctly.

## 7. Backward Compatibility

Projects already scaffolded by kit v0.1.0 have an old `.loop/verify.sh` (no tracing code) and an old `.loop/ltf.config.yaml`. Kit cannot retroactively patch files it doesn't own once `kit init` has exited — there is no migration path other than **re-running `kit init` in the existing project directory**.

Re-running is already exercised by E2E Test 10 ("Idempotent init (re-run doesn't crash)"), but that test only confirms the command *doesn't error* — it does not check content preservation, and it shouldn't be read as evidence that re-running is safe for customized projects. Checking `writeFileSafe` (`src/utils/fs.ts:4-7`) confirms it **unconditionally overwrites** every target; `generateAll` (`index.ts`) only guards `state.md` with a `fileExists` check (line 68) before writing. Every other generated file — `CLAUDE.md`/`AGENTS.md`/`GEMINI.md`, `verify.sh`, `budget.yaml`, `goal.md`, `ltf.config.yaml` — is clobbered on every re-run. This is a pre-existing kit behavior, not something this phase introduces, but this phase is the first time re-running `kit init` becomes something users have a concrete reason to actually do, so it needs to be called out explicitly in the v1.0.0 changelog:

> Re-run `kit init` in existing projects to enable trace emission. This regenerates `CLAUDE.md`/`AGENTS.md`/`GEMINI.md`, `verify.sh`, `budget.yaml`, `goal.md`, and `ltf.config.yaml` from scratch — back up any manual edits to those files first. `.loop/state.md` and any existing `.loop/trace.ltf.jsonl` are preserved.

A narrower `kit upgrade` (or `kit init --hooks-only`) command that refreshes *only* `verify.sh`/`.claude/hooks/verify.sh` without touching the rest would remove this friction, but building it is out of scope for this phase — flagged as an open question in §9.

## 8. Effort Estimate

**Medium.** Not small, because the correctness of the core mechanism hinges on bash/date/grep portability details that are easy to get subtly wrong and that current CI (Linux-only) will not catch (§6). Not large — it touches five existing files plus one new 3-constant module, requires no new runtime dependencies, and the format itself (§2.1) is already fully specified by the sibling project, so there's no schema design work left to do.

Rough breakdown:
- `hooks.ts` rewrite + manual verification on both a Linux and a macOS shell: the highest-risk, highest-care item. The path-resolution logic for the two script copies (`.loop/verify.sh` vs `.claude/hooks/verify.sh` both needing to write to the same `.loop/trace.ltf.jsonl`) is the part most likely to need iteration beyond the sketch in §4.
- `status.ts` schema fix: small, mechanical, well-covered by new unit tests.
- Shared constants extraction, `ltf-config.ts`/`index.ts` updates: small.
- New tests (unit + E2E): medium — spawning real bash subprocesses from vitest and asserting on file side effects is more fiddly than kit's existing pure-function generator tests.

**What could go wrong:**
- **Bash portability beyond macOS/Linux**: this mechanism does not, and cannot, work on native Windows (no bash by default) — this is a *pre-existing* limitation of `verify.sh` in general (it's already bash-only today), not a new regression, but it's worth confirming this is an accepted, known gap rather than a surprise.
- **Custom verify commands with adversarial content**: multi-line custom commands, or ones containing embedded newlines/control characters, could still produce a technically-valid-but-ugly `verification.command` JSON string (`JSON.stringify` handles escaping correctly, so this is a UX concern, not a correctness one — but worth a manual smoke test with a deliberately weird custom command).
- **Concurrent invocation**: if a user runs `.loop/verify.sh` from two shells at once (or an agent + a human both trigger it), the read-modify-write on `.ltf-state.json` has no locking and can race, corrupting the iteration counter or losing an update. Accepted as a known limitation for Phase 1 given how unlikely concurrent verification runs are in practice; worth a one-line comment in the code acknowledging it.
- **Silent trace loss**: the `2>/dev/null || true` wrapper around the entire trace-emission block (chosen deliberately so a tracing bug can never break verification) also means a *real* bug in the trace logic — a typo, a permissions issue — fails completely silently. Recommend, at minimum, that manual/E2E testing runs the block with `set -x` once during development to be sure it's actually the happy path being exercised, not the swallowed-error path.

## 9. Open Questions

1. **Two competing iteration counters.** After this change, `state.md`'s `## Current Iteration` (agent-maintained, updated *after* verify per the current protocol text) and the new tracer's self-counted `iteration` in `.ltf-state.json` (incremented on every `verify.sh` call, independent of agent behavior) will usually agree but are not guaranteed to. Should the loop protocol text in `claude-md.ts`/`codex-md.ts`/`gemini-md.ts` be rewritten so the agent bumps `state.md` *before* calling verify, and should the tracer read that number instead of self-counting — accepting the risk that a non-compliant agent then corrupts trace continuity instead of just its own progress notes? This plan chose the self-counting approach specifically to avoid that dependency, but it's a real design tradeoff a human should sign off on rather than one this plan should silently decide.
2. **Vendoring or depending on `ltf`'s work.** Once `@loop-eng/ltf` is actually published to npm, should kit take a real dependency on its `LTFWriter`/schema validation (replacing the hand-rolled bash JSON construction with something the sibling team already tested 77 ways), and should kit additionally *offer* (not force) the existing Claude-Code-only `adapters/claude-code/install.sh` for users who want the much richer per-tool-call trace and are willing to accept the `jq` dependency? This needs a decision on whether kit's four-agent parity principle ("Cross-agent support: Yes (4 agents)" per `ideas/04-kit.md:300`) should ever be broken for a strictly-better-for-one-agent enhancement.
3. **Budget enforcement is a bigger, adjacent, still-unsolved gap.** While researching this, I confirmed `budget.yaml`'s `max_cost_usd`/`max_iterations`/`max_duration_minutes` (`src/generators/budget.ts`) are, like the old trace file, purely descriptive — nothing in kit's current `src/cli/` reads or enforces them at runtime either. `src/cli/run.ts`, listed in the original architecture doc (`ideas/04-kit.md:191`) as "Launch loop with all guardrails," does not exist in the current `src/cli/` tree. Real termination-reason tracking (`budget_exhausted`, `max_iterations`, `stall_detected` — see §3's "won't capture" list) is blocked on that command existing. Worth deciding whether that's Phase 2 of the v1.0.0 push, and whether it should be sequenced before or after this trace-emission work (a `kit run` supervisor would be a much better, more complete place to own trace-writing than a bash hook, if it's coming soon anyway).
4. **Retention enforcement.** `ltf.config.yaml`'s `retention.max_entries`/`max_size_mb` promise log rotation. This plan explicitly defers implementing it (§4 step 2) and just documents it as advisory. Is that acceptable for v1.0.0, or does an unbounded trace file need a real fix (e.g., a `kit trace prune` command, or truncation logic in `verify.sh` itself) before shipping?
5. **CI platform coverage.** Should `macos-latest` be added to `.github/workflows/ci.yml` as part of this phase, given the BSD-`date` bug this plan had to specifically design around was invisible to the current Linux-only CI?

---

## Implementation Notes (post-hoc, added when this plan was actually implemented)

**Resolved the plan/review fork**: implemented as Approach 1 (self-contained bash, no `jq`, no `.claude/settings.json` merge), NOT the review's hybrid recommendation to also adopt `ltf/adapters/claude-code`. Reasoning: adopting that adapter required building brand-new JSON-merge capability into `.claude/settings.json` in the same phase (real new risk surface, flagged Critical in the review's own F12), a hard `jq` dependency that could silently produce zero traces if absent (F10 — directly undermines "traces by default"), and would only benefit one of Kit's four target agents. Deferred as a documented future enhancement, not silently dropped.

**Open questions resolved:**
1. Two iteration counters — kept separate (tracer self-counts), as originally proposed. Documented in generated `ltf.config.yaml` comments.
2. Vendoring `ltf`'s writer — deferred; `@loop-eng/ltf` remains unpublished (confirmed via `npm view` → 404).
3. Budget enforcement / `kit run` — out of scope, confirmed as a separate, larger architectural gap. Only `goal_met` termination reason is ever emitted for v1.0.
4. Retention enforcement — NOT implemented. `ltf.config.yaml` now explicitly says `enforced: false`.
5. CI platform coverage — not added in this phase (folded into Phase 4's cross-platform CI work instead). Verified directly on this real Darwin machine instead: `date +%s%3N` empirically confirmed to print a literal trailing `N` (e.g. `17851743563N`), and the `now_ms()` fallback was confirmed working end-to-end via real script execution (produced correct, whole-second-granularity `duration_ms` values).

**One new Critical bug found during implementation, not anticipated by either planning document**: `${verifyCommand}` spliced unwrapped into the script meant a custom command containing a literal `exit` call would terminate the entire script before reaching the trace-emission block or even the exit-code capture. Caught via adversarial unit testing (using `exit 0`/`exit 1` as stand-in verify commands). Fixed by wrapping in a subshell: `( ${verifyCommand} )`. See FINDINGS.md #31.

**Verification performed:** 86 unit tests (15 new in `hooks.test.ts` spawning real bash + asserting file side effects, 9 new in a new `status.test.ts`), 53 E2E tests (5 new covering pass path, fail path, iteration/loop_id continuity across both script copies, and `kit status` displaying real trace data) — all passing. Manually verified end-to-end on this real machine: 3-run fail→fail→pass sequence produces exactly the expected 5-line trace with correct iteration numbering and a single `loop_summary`; both `.loop/verify.sh` and `.claude/hooks/verify.sh` confirmed to converge on the same trace file with a shared `loop_id` regardless of invocation cwd.
