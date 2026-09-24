# Audit Findings — @loop-eng/kit

## Summary

3 audit passes produced 30 raw findings. After honest re-evaluation:

- **18 real bugs** — fixed (15 from the v0.1.0 audit + 1 found during v1.0.0 Phase 1 implementation + 2 found during an independent end-to-end fidelity recheck of the v1.0.0 phases). The recheck additionally closed 2 test-coverage gaps where production code was already correct but had no regression test proving it.
- **4 severity-overstated** — fixed but reclassified
- **6 code quality improvements** — applied but not bugs
- **4 theoretical/debatable** — applied as defensive hardening
- **1 duplicate** — removed (#19 = #9)

---

## Real Bugs (15)

### 1. CRITICAL: Dead code in generated verify.sh due to set -e

- **File:** `src/generators/hooks.ts`
- **Description:** `set -euo pipefail` causes bash to exit immediately when the verify command fails, making exit_code capture and the "Verification failed" message unreachable.
- **Fix:** Removed `-e`, added `set +e` / `set -e` around the verify command.

### 3. HIGH: Generated verify.sh missing execute permission

- **File:** `src/generators/index.ts`
- **Description:** `writeFileSync` creates files with 0644. The hook script couldn't be executed directly.
- **Fix:** Added `chmodSync(path, 0o755)` after writing.

### 4. HIGH: Malformed templates crash searchTemplates

- **File:** `src/templates/registry.ts`
- **Description:** Template validation only checked `name` and `description`. Missing `tags` caused TypeError crash in `searchTemplates`.
- **Fix:** Strengthened validation to check all required fields with type checks. Defaults for optional fields.

### 7. MEDIUM: Template agent_instructions defined but never used

- **File:** `src/generators/index.ts`
- **Description:** Every template YAML defined per-agent instructions. The generator silently discarded them.
- **Fix:** All generators now accept and include template instructions.

### 11. HIGH: Single-quote injection breaks bash echo

- **File:** `src/generators/hooks.ts`
- **Description:** Four code paths produce `verifyCommand` strings with embedded single quotes that break the echo line's quoting. Confirmed with live bash test.
- **Fix:** Escape single quotes using `verifyCommand.replace(/'/g, "'\\''")`.

### 12. HIGH: "Custom command" verification never prompts for the actual command

- **File:** `src/cli/init.ts`
- **Description:** Selecting "Custom command" provided no follow-up prompt. The placeholder `echo '...'` exited 0, so verification always passed.
- **Fix:** Added `p.text()` follow-up prompt. Threaded via `WizardAnswers.customCommand`.

### 13. HIGH: Fallback verification exits 0 silently

- **File:** `src/detectors/verification.ts`
- **Description:** When no test runner is detected, the fallback `echo '...'` exited 0, making the verification gate useless.
- **Fix:** All fallback commands now include `&& exit 1`.

### 20. MEDIUM: `program.parse()` instead of `program.parseAsync()`

- **File:** `src/cli/index.ts`
- **Description:** All commands have async action handlers. `parse()` doesn't await the returned promise, so async errors become unhandled rejections. *(Originally claimed Critical — reclassified to Medium. Commander does return a promise; the practical impact is confusing error output, not data loss.)*
- **Fix:** Changed to `program.parseAsync().catch(...)`. Also made version dynamic from package.json.

### 21. HIGH: Spinner not stopped on generateAll error

- **File:** `src/cli/init.ts`
- **Description:** If file writes fail, the Clack spinner keeps running, cursor stays hidden, terminal left in broken state.
- **Fix:** Wrapped `generateAll` in try/catch that always stops the spinner.

### 22. HIGH: No --dir validation in init, score, and status

- **File:** `src/cli/init.ts`, `src/cli/score.ts`, `src/cli/status.ts`
- **Description:** Non-existent or file paths crashed silently with exit 0. Confirmed with live test.
- **Fix:** Added existsSync + statSync validation. Clear error messages, exit 1.

### 24. MEDIUM: ANSI padding misalignment in score output

- **File:** `src/cli/score.ts`
- **Description:** `padEnd(40)` applied after ANSI color wrapping counted invisible escape codes, misaligning columns.
- **Fix:** Apply padEnd before color wrapping.

### 27. MEDIUM: BudgetConfig type says `number` but generator produces `number | null`

- **File:** `src/types.ts`
- **Description:** Public API type didn't match runtime values from the generator.
- **Fix:** Changed to `number | null` for all three budget fields.

### 25. LOW: `process.exit(0)` on wizard cancel

- **File:** `src/cli/init.ts`
- **Description:** Exit 0 on Ctrl+C means chained commands (`kit init && deploy`) proceed as if init succeeded. *(Originally Medium — reclassified to Low. Many CLIs exit 0 on cancel. Defensible convention.)*
- **Fix:** Changed to `process.exit(130)`.

### 10. LOW: Missing error handling in ensureGitignore

- **File:** `src/utils/git.ts`
- **Description:** Permission errors or read-only filesystems would crash `kit init` with raw Node.js error.
- **Fix:** Wrapped in try/catch. Gitignore update is non-critical.

### 9. Falsy coercion `|| null` in budget generator

- **File:** `src/generators/budget.ts`
- **Description:** `opts.maxCostUsd || null` converts 0 to null. In this codebase, 0 always means "unlimited" (from BUDGET_MAP). The `|| null` was correct-by-design. Changed to `> 0` for clarity, but the behavior is identical.
- **Fix:** Changed to `> 0` explicit check. *(Functionally a no-op — same result for all real inputs.)*

---

## Severity Overstated (4) — Fixed, but reclassified

| # | Claimed | Actual | Why |
|---|---------|--------|-----|
| 2 | HIGH: "Shell injection" in echo | LOW | The verify command is user-provided content that's intentionally executed. The real issue was broken quoting in the echo line (cosmetic), not a security vulnerability. Severity language was misleading. Subsumed by finding #11 which properly describes the quoting bug. |
| 14 | HIGH: Hook only at .claude/hooks/ | MEDIUM | Codex/Gemini/Cursor don't have standardized hook paths. The hook was referenced in the generated agent config. Users would find it. Design gap, not a showstopper. |
| 23 | HIGH: Command injection via execSync | LOW | The `cmd` parameter was only ever called with hardcoded strings (`"claude"`, `"codex"`, `"gemini"`). Never user-controlled. Zero real attack surface. Good defensive fix, bad severity claim. |
| 26 | MEDIUM: Missing .eslintrc extensionless | LOW | The extensionless `.eslintrc` is deprecated since ESLint 9 (which this project uses). Detecting a dead format is over-engineering backward compat. |

All four fixes are applied and correct — the issues were real but not as severe as claimed.

---

## Code Quality Improvements (6) — Not bugs

These are all applied and improve the codebase, but calling them "bugs" was inaccurate.

| # | Finding | Reality |
|---|---------|---------|
| 8 | Redundant detection calls | Performance nit. Never produced wrong results. |
| 17 | Double resolveVerifyCommand call | Efficiency nit. Same pure function, same args. |
| 18 | Redundant join(resolve()) | Style inconsistency. Produced correct results. |
| 28 | Identity ternary dead code | Code cleanup. `x === 'a' ? 'a' : x` always equals `x`. |
| 29 | git.ts lines recomputed in filter | Micro-optimization. Array has 2 entries. Unmeasurable. |
| 30 | CI Node 18 EOL | Maintenance chore. CI still worked. |

---

## Theoretical / Debatable (4) — Applied as defensive hardening

| # | Finding | Assessment |
|---|---------|------------|
| 5 | `which` fails on Windows | Real gap but theoretical for macOS/Linux-targeting MVP. |
| 6 | Files overwritten on re-run | Design choice (ACCEPTED). Most scaffolders overwrite. |
| 15 | Falsy-zero hides $0 cost cap | Who sets a cost cap of $0? Theoretical edge case. |
| 16 | Template path resolution fragile | Templates loaded correctly in every test. Fix added validation but original wasn't broken. |

---

## Duplicate (1) — Removed

| # | Finding | Duplicate Of |
|---|---------|-------------|
| 19 | `|| null` falsy coercion in budget.ts | Same bug as #9. Both describe the same line. Counted twice across audit passes. |

---

## Final Verified Numbers

```
Real bugs found and fixed:     15
Improvements applied:          14 (overstated + quality + theoretical)
Duplicates:                      1
Total changes:                  30 (all applied, all correct)
```

---

## v1.0.0 Phase 1 (LTF Trace Integration) — bug found during implementation

### 31. CRITICAL: `exit` in a custom verify command terminates the whole script before tracing

- **File:** `src/generators/hooks.ts`
- **Severity:** Critical
- **Description:** `${verifyCommand}` was spliced directly into the generated script as literal bash source, unwrapped. `set +e`/`set -e` only controls auto-exit-on-nonzero-return; it does not change the behavior of the `exit` builtin, which always terminates the *current* shell when invoked. Discovered via adversarial unit testing using `exit 0`/`exit 1` as a stand-in verify command — the script terminated immediately at that line, never reaching `exit_code=$?`, duration calculation, or LTF trace emission. This is a real risk for Kit's "custom command" verification mode, where a user-authored script could plausibly end with an explicit `exit` call (a common shell idiom).
- **Fix:** Wrapped the verify command in a subshell: `( ${verifyCommand} )`. An `exit` inside a subshell only terminates the subshell; the parent script's `exit_code=$?` correctly captures its exit status. No behavior change for the overwhelming majority of real verify commands (test runners, build tools) since subshell execution is observationally identical for stdout/stderr/exit-code.
- **Status:** FIXED — caught before merge via the adversarial-testing step of Phase 1's own verification loop, not by a user report.

---

## End-to-End Fidelity Recheck (v1.0.0 phases) — 2 real bugs, 2 test-coverage gaps

After all 5 v1.0.0 phases were implemented, 5 independent verification agents re-checked each
phase's actual code against its planning + review documents. Two genuine production bugs and
two test-coverage gaps (production code already correct, but with no regression test proving
it) were found and fixed.

### 32. HIGH: `loop_summary` re-emitted on every successful re-run, not just the first

- **File:** `src/generators/hooks.ts`
- **Severity:** High
- **Description:** `ltf-config.ts`'s generated comment explicitly promised `loop_summary` is "emitted once, only on the first passing verification" — but the actual condition (`if [ "$result_status" = "success" ]`) fired unconditionally on every successful run. Confirmed empirically: 3 consecutive successful `verify.sh` invocations produced 3 separate `terminate`+`loop_summary` pairs sharing one `loop_id`, not one. A user re-running verification after the loop already succeeded (e.g. a periodic CI re-check) would accumulate multiple summary records, directly contradicting the documented, spec-aligned behavior (SPEC.md: loop_summary is a one-time terminal record per loop).
- **Fix:** Added a `summarized` flag to the tracer's `.ltf-state.json`, set to `1` the first time a successful run occurs. Subsequent successful runs still emit a `verify` event but skip the `terminate`/`loop_summary` pair once `summarized` is already `1`.
- **Status:** FIXED. Regression test added: `hooks.test.ts` — "emits loop_summary exactly once, even after multiple successful re-runs."

### 33. MEDIUM: `--agent` flag output order was insertion order, not canonical

- **File:** `src/cli/init.ts`
- **Severity:** Medium
- **Description:** The Phase 2 plan specified canonical agent ordering (matching `ALL_AGENTS`'s declared order) regardless of how a user lists agents in `--agent`, so generated file lists and `.loop/kit.json` are deterministic. `parseAgentFlag` instead preserved insertion order: `--agent gemini,codex` produced `["gemini", "codex"]` instead of the canonical `["codex", "gemini"]`. Cosmetic only (no missing files, no duplicates, no crash) but a real deviation from spec.
- **Fix:** `parseAgentFlag` now collects requested agents into a `Set` and filters `ALL_AGENTS` by membership, guaranteeing canonical output order.
- **Status:** FIXED. Regression test added: `init.test.ts` — "normalizes output to canonical order regardless of input order."

### 34. Test-coverage gap: FINDINGS #25's regression test never actually checked the exit code

- **File:** `src/cli/__tests__/init.test.ts`
- **Severity:** N/A (test gap, not a production bug — `process.exit(130)` was already correct in `src/cli/init.ts`)
- **Description:** A describe block was literally titled "regression: FINDINGS #25, exit 130 not 0," but every test inside only asserted `runWizard()` returns `null` on cancellation — never that the CLI actually calls `process.exit(130)`. The real exit call lives in the Command action handler, which no test imported or exercised. A revert of `process.exit(130)` back to `process.exit(0)` would have passed the entire suite.
- **Fix:** Extracted the inline cancel-and-exit logic into standalone exported functions (`exitOnWizardCancel`, `exitOnInvalidDir`, `exitOnInvalidAgentFlag`, `exitOnTemplateNotFound`) and added tests that mock `process.exit` and assert it's called with the correct code. Verified via mutation testing: reverting `exitOnWizardCancel` to `process.exit(0)` now fails the new test.
- **Status:** FIXED.

### 35. Test-coverage gap: `warnIfBashUnavailable`'s actual warning-firing branches were untested

- **File:** `src/cli/__tests__/init.test.ts`
- **Severity:** N/A (test gap — production logic in `src/cli/init.ts` was already correct)
- **Description:** Only the non-Windows no-op branch had a test. The two Windows branches — including the one that produces the actual user-visible warning — had zero coverage.
- **Fix:** Added `vi.mock` for `commandExists` and two new tests covering win32-with-bash-absent (warning fires) and win32-with-bash-present (no warning).
- **Status:** FIXED.
