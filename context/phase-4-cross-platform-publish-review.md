# Phase 4 Adversarial Review: Cross-Platform CI & npm Publish Readiness

**Reviewer stance:** independent, skeptical. This document was produced without reading the parallel agent's plan. Where recommendations below turn out to disagree with that plan, that disagreement is intentional and should be adjudicated by a human, not silently merged.

**Method note:** every factual claim below was verified against the actual repo state on 2026-07-27 (`npm pack --dry-run`, `tar -tvf`, grep of source, inspection of `ci.yml`/`agent.ts`/`hooks.ts`/`package.json`), not assumed. Verification commands are inline so they can be re-run.

---

## 1. Windows/bash verdict

**Verdict: this is a real but narrow landmine. Document it as a hard prerequisite; do NOT build a `.ps1` generator for v1.0.0.**

### The mechanism, precisely

`src/generators/hooks.ts` emits a bash script (`#!/usr/bin/env bash`, `set -uo pipefail`, single-quote-escaped `verifyCommand`) that is the *entire* verification gate — it's what tells the agent loop "the change is good, stop iterating" or "the change is bad, keep going." There is no non-bash fallback anywhere in the codebase. `src/generators/index.ts` `chmodSync`'s it to `0o755` and writes it to `.loop/verify.sh` / `.claude/hooks/verify.sh`. If this script cannot execute, the loop's core safety mechanism is silently absent — an agent could report success/failure based on a hook that fails-to-launch, not fails-verification, and those two failure modes are NOT distinguished anywhere in the generated script or in kit's own code.

### Is it already a non-issue in practice?

Partially, and the argument for "non-issue" is stronger than it first appears, but it is not airtight:

- **Claude Code, Codex CLI, and Gemini CLI** (the three agents kit's own `detectAgent()` in `src/detectors/agent.ts` explicitly targets) are all Node-based CLIs distributed via npm. None of them require WSL or a POSIX shell to *run* — they run natively as Node processes on Windows (`cmd.exe`/PowerShell). This is the load-bearing assumption in the "non-issue" argument, and on inspection it's **not as solid as the task framing suggested**: these agents don't inherently need Git Bash to function as chat/agentic tools. What they need Git Bash (or WSL) for is specifically *this* verification hook, and any other bash-based tooling a project happens to invoke (many JS/TS projects use bash scripts in `package.json` `scripts` already, so plenty of Windows Node developers already have Git Bash installed as a matter of course — but "many" is not "all").
- Git Bash ships bundled with **Git for Windows**, which is close to universal among Windows developers who use git at all (which is effectively 100% of anyone running `kit init` inside a git repo, which is kit's expected use case). So the realistic gap is: *Windows users who have git installed via a non-Git-for-Windows path* (e.g., `winget install Git.Git` still installs Git for Windows/Git Bash; but GitHub Desktop's bundled git, or `scoop`/`choco` installs of "git" that pull a minimal git without bash, or corporate-locked-down machines with git preinstalled by IT without Git Bash) — a real subset, not a phantom one.
- **PowerShell's `where`/`which` equivalent already works** — `agent.ts`'s `commandExists()` correctly branches to `where` on win32 (verified: `process.platform === "win32" ? "where" : "which"` at line 37). So agent *detection* is fine on native Windows. It's specifically *verification execution* that's broken, and only for the fraction of Windows users lacking a bash interpreter on PATH.

### Concrete failure scenario (for the record, since the task asks for one even under a "non-issue" conclusion)

A Windows developer at a company that provisions git via an internal MSI that installs `git.exe` and `git-lfs` but strips the bundled `usr/bin` (a real practice for reducing installer footprint / avoiding bundling GNU utilities) runs `kit init`, selects "Claude Code," picks a verification command. `kit init` succeeds, prints success, writes `.claude/hooks/verify.sh`. The developer never touches that file directly — it's invoked by Claude Code's hook system. First agent iteration: Claude Code tries to exec `.claude/hooks/verify.sh`. On Windows this either fails outright (`%1 is not a valid Win32 application` if invoked directly) or silently no-ops depending on how the calling agent shells out. The developer sees the loop either hang, error opaquely, or (worst case) treat a non-executing hook as vacuous success and never actually gate anything. Nothing in kit's own error surface tells them "you need Git Bash" — they discover it by debugging someone else's tool's hook-invocation code, which is a bad experience and a support-burden generator.

### Why NOT build `.ps1` dual-generation for v1.0.0

- It doubles the generator surface (`hooks.ts` becomes two implementations that must stay semantically identical — same escaping semantics, same exit-code semantics, same `set -e`-equivalent trap logic in PowerShell, which has different idioms entirely for "continue on error, capture exit code, then decide").
- It doubles the test burden (`hooks.test.ts` and whatever generators/index tests touch this) and introduces an entire OS's shell semantics (PowerShell error action preferences, `$LASTEXITCODE` vs `$?`, quoting rules that are *meaningfully different* from bash's, not a mechanical transliteration) that nobody on this team has evidently exercised yet (grep confirms zero `.ps1` or PowerShell references anywhere in `src/`).
- The actual agent tools (Claude Code, Codex, Gemini) invoke hooks as shell commands per their own hook-config format — supporting `.ps1` cleanly would also require confirming each of those three agents' hook-invocation mechanism can even target a `.ps1` file with the right interpreter, which is a dependency on three external, evolving tools' hook specs that this team doesn't control. That's a lot of surface for a v1.0.0 gate with zero reported user complaints so far (product has never been published, so "zero complaints" carries little weight, but there's also no existing usage data pointing the other way).
- The cost of the alternative (explicit documentation + a clear runtime error) is roughly one paragraph in the README plus a ~10-line preflight check. That is a vastly better cost/benefit than a second code generator.

### What to do instead (concrete, cheap, and should be in Phase 4 scope regardless of what the other agent proposes)

1. **Document it explicitly** as a prerequisite in the README's "Requirements" / "Installation" section: *"On Windows, kit's verification hooks are bash scripts. Install Git for Windows (includes Git Bash) or use WSL. A future release may add native PowerShell support if requested."* One sentence, high leverage.
2. **Add a preflight check** (small, cheap, high value — arguably higher value than either CI or docs alone): before or during `kit init`, when `process.platform === "win32"`, run `commandExists("bash")` (the same primitive `agent.ts` already has) and if absent, print a clear warning *at generation time*, e.g. `"⚠ No bash interpreter found on PATH. Generated verification hooks require bash (Git Bash or WSL) to run. Install Git for Windows: https://git-scm.com/download/win"`. This converts a silent, hard-to-diagnose runtime failure into an actionable, immediate one. This is maybe 15 lines of code and one test case — far cheaper than dual generation, and it's the single highest-leverage fix available for this problem.
3. Do **not** promise `.ps1` generation for v1.0.0. Log it as a backlog item, gated on an actual user report (see trigger criteria in §5's spirit — build for demonstrated need, not hypothetical completeness).

---

## 2. CI matrix recommendation

**Verdict: the current matrix (ubuntu-latest × Node 20/22) is under-testing the one piece of OS-branching code that exists, and a full OS × Node matrix would be significant overkill for what needs proving. Add one job, not a grid.**

### Cost reality check (GitHub Actions, public repo)

This is a **public** repo (`github.com/loop-eng/kit`, MIT license, per `package.json`). GitHub Actions minutes are **free and unlimited for public repositories** for standard runners — the widely-cited 10x macOS / 2x Windows multipliers apply to **private repos** billed against included minutes. So the "cost" framing in the task (macOS ~10x, Windows ~2x) is the right mental model in general, but for this specific project **the dollar cost is currently zero regardless of matrix size**, since kit is public. This matters and should be said plainly rather than importing a private-repo cost argument that doesn't apply here.

Given that, the honest case against a full matrix is **not** billing — it's:
- **Signal-to-noise / maintenance cost**: more matrix cells = more flaky-runner noise, longer wall-clock feedback loops on every PR, more "which cell failed and why" triage overhead for a solo/small-team maintainer.
- **False confidence**: running the *entire* 64+39 test suite on macOS and Windows mostly re-proves that Node's standard library and this project's platform-agnostic logic (fs, path, YAML parsing, template rendering, prompts) work the same everywhere — which they overwhelmingly do, because that's the whole point of Node's cross-platform abstractions. It does **not** specifically target the one place where custom, hand-written OS-branching logic lives.
- **Time cost still matters even at $0**: PR feedback latency and maintainer attention are real costs even when Actions-minutes are free.

### What actually needs Windows-specific proof

Grepped the full `src/` tree for platform branching: the **only** `process.platform`/`win32` branch in the entire codebase is `src/detectors/agent.ts` line 37 (`where` vs `which`). There is no other path-separator-sensitive or OS-conditional logic in `src/` (verified via `grep -rn "process.platform|win32|/bin/sh|spawn(|execFileSync|execSync" src/`). Everything else uses `node:path`'s `join()`, which is already platform-correct by construction and doesn't need a Windows runner to validate — that's exactly the kind of thing Node's own path module is tested for upstream.

Also confirmed: `src/detectors/__tests__/agent.test.ts` currently has **zero** tests that mock or exercise the `win32` branch — every existing test runs `detectAgent()` under whatever `process.platform` the CI/dev runner happens to have (always `linux` today). This is a real, present-tense coverage gap independent of any CI matrix decision.

### Recommended minimal-but-sufficient matrix

```yaml
build:
  strategy:
    matrix:
      os: [ubuntu-latest]
      node-version: [20, 22]
  # ... existing steps unchanged

windows-smoke:
  runs-on: windows-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 22, cache: npm }
    - run: npm ci
    - run: npm run build
    - run: npm run test   # full suite, once, on the newest Node only
```

Plus, independent of CI topology, a **targeted unit test** added to `agent.test.ts`:

```ts
it("uses 'where' for command lookup on win32", () => {
  vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  const spy = vi.spyOn(childProcess, "execFileSync");
  // ... assert spy called with "where", not "which"
});
```

This is the change the task description explicitly floats as the alternative to a full Windows runner ("TARGETED unit test that mocks `process.platform`") — and on inspection it's the **higher-value** of the two, because it actually exercises the specific branch, whereas a Windows CI runner running the *whole* suite mostly just re-confirms Node's cross-platform guarantees. Recommend doing **both**: the platform-mock unit test because it's nearly free and directly targets the risk, and one `windows-latest` smoke job because it also validates things a mock can't — `npm ci`/`npm run build`/`tsup` bundling actually working end-to-end on Windows's filesystem and shell (CRLF handling, path-length limits, case-insensitivity quirks), which is a different and legitimate risk class from the single `where`/`which` branch.

Explicitly **not recommended**: `macos-latest` in the routine PR matrix. There is no macOS-specific code path anywhere in `src/` (macOS and Linux are both POSIX; the bash-script generation behaves identically on both). Add a macOS smoke job only if/when a macOS-specific bug is ever actually reported — don't pre-build coverage for a risk class with zero identified surface area. This is the same "build for demonstrated need" principle applied to CI as to the `.ps1` question in §1.

Net proposal: **2 Linux jobs (existing) + 1 Windows smoke job = 3 jobs**, not 3 OS × 2 Node = 6. Given the repo is public and Actions minutes are free, this is a time/attention tradeoff, not a dollar one — and 3 targeted jobs beat 6 broad ones on both axes.

---

## 3. Packaging risk audit

Verified directly via `npm pack --dry-run` and `tar -tvf` on the actual current tree — not inferred from config alone.

### `.npmignore`: does not exist

Confirmed: `ls .npmignore` → "No such file or directory". This is **fine, not a gap**, because `package.json` has an explicit `files` allowlist (`["dist", "templates", "README.md", "LICENSE"]`), and **npm's documented behavior is that when `files` is present, it is an allowlist that takes precedence — `.gitignore`/`.npmignore` exclusion rules are only consulted for patterns *not* covered by an explicit `files` allowlist, and in practice an explicit `files` array is the dominant, safer mechanism.** This project has done the safer thing already (explicit allowlist, not gitignore-shadowing), which is worth stating positively rather than treating the missing `.npmignore` as a defect.

That said, two `files`-allowlist footguns are worth naming explicitly since the task asks to actually check, not assume:

- **`package.json` itself and `LICENSE`/`README.md` are always included by npm regardless of `files`** (npm hardcodes these as always-packed) — so their absence from `files` would not have been a bug; their presence here is redundant-but-harmless documentation of intent, not a functional necessity. Not a bug, just worth knowing.
- **`bin`-referenced files are always included even if their directory isn't literally spelled out in `files`**, but here `dist` *is* listed, so this is moot for kit — flagging only because it's a common source of confusion when auditing `files` arrays.

### Verified actual tarball contents (`npm pack --dry-run`, 2026-07-27)

```
LICENSE, README.md, dist/cli.js, dist/cli.js.map, dist/index.cjs,
dist/index.cjs.map, dist/index.d.cts, dist/index.d.ts, dist/index.js,
dist/index.js.map, package.json, templates/*.yaml (6 files)
17 files total, 33.7 kB packed / 156.4 kB unpacked
```

**`context/` is correctly excluded** — confirmed absent from the tarball listing. It is not in `files`, and even if it *were* accidentally git-tracked (it is: `context/CONTEXT.md` exists and is not gitignored), the `files` allowlist means it still wouldn't ship. This is the specific footgun the task asked about, and the answer is: **no leak, allowlist behavior is protecting correctly here.** Good, but worth an explicit regression check (see acceptance criteria) so a *future* change to `files` (e.g., someone adding `"**/*"` or removing granularity) doesn't silently reintroduce it.

**No `.env` files exist in the repo at all** (verified via `find`), so there's currently nothing to leak on that front — but there's also no structural guard against one being added later and accidentally swept in by some future looser `files` pattern. Low priority given current `files` is already tight and explicit, not glob-happy.

**`demo/` directory (`cleanup.sh`, `test_e2e.sh`, `trial.sh`) and `FINDINGS.md`** (the internal bug-audit doc, 8KB) are also correctly excluded by the same allowlist mechanism — worth naming since `FINDINGS.md` in particular is the kind of "internal planning doc" the task worried about, and it's fine, but only because `files` stays disciplined. This is a "the current state is good, protect it" finding, not a "fix this" finding.

### Source maps ship to consumers

`dist/cli.js.map` (66.7 kB — nearly **double** the size of `cli.js` itself at 33.7 kB) and the `index.*.map` files are included because `files` includes the whole `dist` directory and `tsup.config.ts` has `sourcemap: true` with no exclusion. This is not wrong, but it's worth a conscious decision rather than an accident: shipping source maps in an npm CLI package is a legitimate choice (better stack traces for bug reports) but roughly doubles package weight for a tool most users will `npx` transiently. Flagging as a **judgment call for Phase 4**, not a defect — recommend explicitly deciding rather than leaving it as an emergent side effect of default tsup config.

### `bin` shebang / executable-bit survival through pack → publish → install

**Directly tested, not assumed.** Ran `npm pack` (not just `--dry-run`) and inspected the real tarball with `tar -tvf`:

```
-rwxr-xr-x  0 0      0       33709 ... package/dist/cli.js
```

**Confirmed: the executable bit (`755`) survives into the actual tarball**, even though the source `tsup` build step does not itself chmod the file (grep confirms `chmodSync` in this codebase is only used in `src/generators/index.ts` for *generated user-project hook scripts*, never for `dist/cli.js`). This works because **npm's own pack/publish pipeline (via `@npmcli/arborist`/`libnpmpack`) automatically forces executable permissions on any file referenced by the `bin` field**, independent of the file's on-disk mode at pack time — this has been standard npm behavior since npm 7 and is a real, historically-flaky-in-older-npm area, so verifying it directly (as done here) rather than trusting it by convention was the right call.

**What the dry-run/rehearsal procedure should specifically check** (concrete, since the task asks for specifics, not just "test it"):
1. `npm pack` (real pack, not `--dry-run`, since `--dry-run` does not always exercise identical file-mode logic — confirmed by using the real pack here) then `tar -tvf *.tgz | grep cli.js` and assert the mode column shows `x` bits (`rwxr-xr-x` or equivalent), not `rw-r--r--`.
2. Extract the tarball to a scratch directory, `npm install -g ./package` (or `npm link` from the extracted dir), and actually invoke `kit --version` or `kit --help` as a bare command (not `node dist/cli.js`) — this is the only way to catch a shebang/PATH/permission problem that would manifest specifically for end users typing `kit` after a real global install, as opposed to a developer always invoking it through `node`.
3. Confirm the shebang line itself (`#!/usr/bin/env node`, injected by `tsup.config.ts`'s `banner.js`) is the literal first line of the packed `dist/cli.js` with no BOM or leading whitespace — a stray byte before `#!` silently breaks shebang execution on POSIX and is a known footgun with some bundler/banner configurations. Quick check: `head -c 20 dist/cli.js | xxd` and confirm it starts with `23 21 2f 75 73 72` (`#!/usr`) with no BOM bytes (`ef bb bf`) preceding it.

---

## 4. Safe publish rehearsal procedure

npm unpublish is restricted (72-hour window, and even within it, discouraged and disallowed if another package now depends on the version, per npm's unpublish policy) — the plan must not rely on "we can just unpublish if it's wrong." Rehearsal must happen **before** touching the real `@loop-eng/kit` name/version.

Recommended layered rehearsal, cheapest/safest first:

**Layer 1 — `npm publish --dry-run` (zero risk, does not hit the registry at all).**
Run exactly the `publish` job steps from `ci.yml` locally: `npm ci && npm run build && npm publish --dry-run --provenance --access public`. This validates the tarball contents, exercises `prepublishOnly` (`npm run build`), and surfaces registry-side validation errors (auth scoping, package name availability/ownership, `access public` requirement for scoped packages) **without publishing anything**. This should be step zero and costs nothing.

**Layer 2 — local pack + install rehearsal (zero registry risk).**
The three-step procedure from §3 above (`npm pack`, extract, `npm install -g` from the extracted tarball, run `kit --help`/`kit init` in a scratch temp directory end-to-end). This is the only layer that catches *real* global-install behavior (PATH resolution, shebang execution, `files`/permissions as actually experienced by a user), and it's fully local — no registry interaction, no name/version consumed.

**Layer 3 — scoped throwaway-name rehearsal on the real registry (low risk, recommended before the very first real publish only).**
Publish once to a disposable name under a scope the maintainer controls but that isn't the real package — e.g. `@loop-eng/kit-publish-rehearsal` or a personal scope like `@rajfirke23/kit-rehearsal-test` (needs a scope the account can publish to; `@loop-eng` itself is fine to use for the *rehearsal name* as long as it's clearly a throwaway, e.g. `@loop-eng/kit-rehearsal`, and deleted/deprecated immediately after). Publish `0.0.0-rehearsal.0`, then in a clean temp directory `npm install -g @loop-eng/kit-rehearsal` (or scoped equivalent) from the **real registry**, and run the same `kit --help` smoke check. This is the only layer that validates real registry CDN propagation, real `npm install` resolution, and real provenance/`--access public` attestation behavior end-to-end — things a local pack cannot fully simulate. Recommend running this exactly once, before the very first real `v1.0.0` (or whatever the first real tag is) publish, not on every release — its marginal value drops sharply once Layer 1+2 have been run successfully a few times and the pipeline is trusted.

Do **not** skip straight to a real `@loop-eng/kit@1.0.0` publish on the theory that "dry-run already covers it" — dry-run explicitly does not exercise the registry-side interactions (name/scope permission errors, provenance attestation against the real Sigstore/GitHub OIDC flow that `--provenance` invokes, since `ci.yml` already uses `id-token: write` for provenance) that have historically been where first-publish surprises happen. Layer 3 exists specifically to catch those without spending the real name/version.

After Layer 3 succeeds: `npm deprecate @loop-eng/kit-rehearsal "rehearsal only, do not use"` (deprecation, not unpublish — cleaner, doesn't hit the 72-hour unpublish restriction machinery, and leaves an honest trail rather than a mysteriously vanished package).

---

## 5. Versioning strategy recommendation

**Verdict: changesets or semantic-release would be premature process overhead for this project's actual current state. Recommend manual semver with a lightweight convention, revisit when contributor count grows.**

Current facts: single-package repo, `version: "0.1.0"`, `author` is a single named individual, no `CONTRIBUTING.md`, no evidence of external contributors (this is a solo-maintainer project per every artifact inspected — `package.json` author field, git history context from prior phases per project memory). The `ci.yml` `publish` job already triggers cleanly off `tags: ["v*"]` — the mechanical trigger plumbing needed for *either* a manual or automated versioning approach already exists and doesn't need to change regardless of which strategy is chosen.

**Recommended simple strategy:**
1. Manual `npm version <major|minor|patch>` (git-tag-creating, built into npm, zero new dependencies) run locally by the maintainer when cutting a release. This produces the `v*` tag `ci.yml`'s `publish` job already watches for — no CI changes needed to support this.
2. A hand-maintained `CHANGELOG.md` (plain markdown, updated as part of the same commit as the version bump) following "Keep a Changelog" conventions loosely — not enforced by tooling, just a habit, reviewed as part of the release commit.
3. Semver discipline enforced by human judgment and PR review (currently trivial since there's one contributor to judge), not by automated conventional-commit parsing.

**Why not changesets/semantic-release now:**
- Both tools solve **multi-contributor coordination problems**: "who decides what the next version bump is when 5 people's PRs land in the same window," and "how do we avoid a human forgetting to bump the version." With one contributor, there is no coordination problem to solve — the same person writing the code decides the version number in the same sitting, so the tool would be automating a decision that currently costs zero coordination overhead to make manually.
- changesets specifically adds a required per-PR artifact (a changeset file) and a bot/CLI dependency; semantic-release adds commit-message-format enforcement (conventional commits) as a hard requirement for version inference to work at all. Both are recurring taxes paid on every single change, for a benefit (automated multi-contributor changelog aggregation and release-note assembly) that doesn't exist yet with one contributor.
- Given the project is pre-1.0 and has never been published, adding release-automation tooling now is solving for a future scale problem before the present, simpler problem (get a working, well-packaged, well-verified v1.0.0 out) is solved. Sequencing matters — this belongs in a later phase, if at all.

**Concrete upgrade trigger** (so this isn't just "add it never" — it's "add it when a specific, checkable condition is met"): revisit and likely adopt changesets (lighter-weight than semantic-release, doesn't force a commit-message convention retroactively onto existing history) when **either** (a) the project has 3+ contributors who have each landed a merged PR within the same rolling 90-day window (i.e., genuinely concurrent, not just cumulative-ever), **or** (b) release cadence exceeds roughly one release per week sustained for a month, such that manual version-bump/changelog upkeep becomes a bottleneck rather than a two-minute step. Either condition is objectively checkable from git/GitHub history without judgment calls, which is the point of naming a trigger instead of a vague "when it grows."

---

## 6. Acceptance criteria checklist

Phase 4 should not be considered done until each of the following is independently verifiable (commands given where applicable, so "done" is checkable, not asserted):

- [ ] README documents the bash/Git-Bash-or-WSL requirement for Windows users explicitly, in a Requirements/Installation section a first-time Windows user would actually see before running `kit init`.
- [ ] A preflight check exists (win32 + no bash on PATH → visible warning at generation time, not silent failure at hook-execution time later). Verify by mocking `process.platform = "win32"` and absence of `bash` on PATH in a test, asserting the warning fires.
- [ ] `src/detectors/__tests__/agent.test.ts` (or a new file) has a test that mocks `process.platform = "win32"` and asserts `commandExists`/`detectAgent` invokes `where`, not `which`. (Currently absent — confirmed by direct inspection.)
- [ ] CI includes at least one `windows-latest` job that runs `npm ci && npm run build && npm run test` to completion (not just typecheck/lint).
- [ ] `ci.yml`'s existing Linux matrix (Node 20/22) is preserved; no regression to single-Node testing.
- [ ] `npm pack --dry-run` output is diffed against an explicit expected file list as part of CI or a pre-release script, so a future accidental change to `files` (e.g. someone widening a glob) that reintroduces `context/`, `demo/`, `FINDINGS.md`, or a stray `.env` is caught mechanically, not by memory. (No such check exists today.)
- [ ] Real `tar -tvf` inspection of a freshly built tarball confirms `dist/cli.js` mode bits include executable (`x`) — added as a one-line assertion in a release-prep script or CI step, not just a one-time manual check (this review's confirmation is a point-in-time fact, not a standing guarantee unless it's automated).
- [ ] `npm publish --dry-run` runs clean locally before any real tag push.
- [ ] A local pack+global-install+`kit --help` smoke test has been run manually at least once by the maintainer before the first real publish, per §4 Layer 2.
- [ ] A scoped rehearsal publish (§4 Layer 3) has been executed and deprecated before the first real `@loop-eng/kit` publish.
- [ ] `CHANGELOG.md` exists (even minimal) and the release procedure (however lightweight) is written down somewhere a future contributor could follow without asking the maintainer — even a paragraph in `CONTRIBUTING.md` or `README.md` counts; it does not need to be a tool.
- [ ] A decision has been made (not defaulted into) on whether source maps ship in the published package, per §3's flagged judgment call.

---

## 7. Open questions requiring a human decision

1. **Scope name for the rehearsal publish (§4 Layer 3)**: does the maintainer want to burn a throwaway name under the real `@loop-eng` scope (e.g. `@loop-eng/kit-rehearsal`), or use a personal scope instead? This affects who/what is visible on the npm registry during rehearsal and should be the maintainer's call, not assumed.
2. **Source maps in the published package**: ship them (better bug-report stack traces, ~2x package weight) or strip them from the `dist` that gets published (leaner package, worse debuggability for anyone inspecting a crash from an installed copy)? Currently shipping by default as an emergent side effect of `tsup.config.ts`'s `sourcemap: true` plus the unfiltered `dist` entry in `files` — this should be a conscious choice.
3. **Windows PowerShell support timeline**: this review recommends deferring `.ps1` generation indefinitely, pending actual user demand. Does the maintainer want a firmer commitment (e.g., "revisit at v1.1 regardless of demand") or is "wait for a real report" acceptable indefinitely? Affects what, if anything, goes in a public roadmap/README promise.
4. **macOS CI coverage**: this review recommends no routine macOS job (no macOS-specific code exists today). Is the maintainer comfortable with that residual risk, or is there a reason (e.g., anticipated Homebrew distribution, or known macOS-specific `execFileSync`/path quirks not yet in the codebase) to add it preemptively anyway?
5. **Changesets/semantic-release trigger ownership**: the trigger conditions in §5 (3+ concurrent contributors in 90 days, or weekly release cadence for a month) are proposed as objective and checkable — does the maintainer agree these are the right thresholds, or is there a different signal (e.g., "the day I add a second maintainer with publish rights, regardless of contribution count") that should gate this instead?
6. **Preflight bash-check strictness**: should the missing-bash warning in `kit init` (§1) be a soft warning that lets `init` complete anyway (current recommendation), or should it be a hard failure that blocks scaffold generation until resolved? A hard block is more protective but also more paternalistic — worth a deliberate call rather than defaulting to whichever is easier to implement.
