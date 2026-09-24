# Phase 4: Cross-Platform CI + npm Publish Readiness

Status: **planning only — no code changed**
Author: planning agent, 2026-07-27
Scope: close the three v1.0.0 blockers below before the first real `npm publish`.

---

## 1. Problem Statement

### 1.1 CI only tests one platform

`.github/workflows/ci.yml:14-18`:

```yaml
build:
  runs-on: ubuntu-latest
  strategy:
    matrix:
      node-version: [20, 22]
```

Every `build`/`typecheck`/`lint`/`test` run happens exclusively on `ubuntu-latest`. There is no `macos-latest` or `windows-latest` leg. `package.json` declares `"engines": { "node": ">=20" }` with no OS restriction, and the README's `npm install -g @loop-eng/kit` / `npx @loop-eng/kit init` instructions make no platform caveat — so the published contract is "works everywhere npm works," but only Linux is verified.

### 1.2 Windows-specific code paths are unverified

`src/detectors/agent.ts:35-43`:

```ts
function commandExists(cmd: string): boolean {
  try {
    const lookup = process.platform === "win32" ? "where" : "which";
    execFileSync(lookup, [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
```

The `win32` branch (`where` instead of `which`) has existed since the initial audit pass (`FINDINGS.md:141`, finding #5, explicitly logged as "real gap but theoretical for macOS/Linux-targeting MVP") and has never executed on a real Windows machine or a Windows CI runner. Nothing regression-tests it.

Path handling itself (`src/utils/fs.ts`, `src/utils/git.ts`, `src/generators/index.ts`, `src/cli/init.ts`, `src/cli/score.ts`, `src/cli/status.ts`, `src/templates/registry.ts`, `src/detectors/*.ts`) uniformly uses `node:path`'s `join`/`resolve`/`dirname`, including forward-slash literals like `join(dir, ".loop/verify.sh")` passed as a single path segment — `path.join` normalizes these correctly on Windows (backslash-separated output), so **this part is not a real bug**. No file in `src/` does manual string concatenation with `/`. This should be captured by a Windows CI leg but is not expected to surface failures.

The real Windows risk is the **generated artifact**, not the generator:

`src/generators/hooks.ts:1-22` unconditionally emits a bash script:

```ts
return `#!/usr/bin/env bash
set -uo pipefail
...
```

`src/generators/index.ts:34-46` writes this same content to `.loop/verify.sh` (always) and to `.claude/hooks/verify.sh` (when the target agent is `claude-code` or `cursor`), then `chmodSync(..., 0o755)`. Kit's own README describes this file as **the** "Verification gate — runs after each agent iteration" (README.md:58, :127). On a Windows machine with no `bash` on `PATH` (no Git for Windows, no WSL), this file cannot be executed at all — the loop's core enforcement mechanism silently has no runnable gate. `demo/test_e2e.sh` (the 39 "E2E tests" referenced in project memory) is itself a bash script (`#!/usr/bin/env bash`, `demo/test_e2e.sh:1`) invoked via `bash demo/test_e2e.sh` and is **not wired into `ci.yml` at all** — CI only runs `npm run test` (vitest unit tests, 64 of them). This matters for the CI proposal below: even adding a Windows runner to `ci.yml` today would not exercise the E2E suite, and by extension would not prove the generated `verify.sh` is runnable in the environment CI runs in.

README.md has **no stated OS prerequisite** anywhere (Installation section, README.md:64-72, lists only `npx`/`npm install -g`, no OS caveat). This is a real documentation gap: Windows is implicitly promised to work, and isn't guaranteed to.

### 1.3 `npm publish` has never been dry-run

`package.json`:
- `"bin": { "kit": "./dist/cli.js" }` (line 6-8)
- `"exports"` maps `.` to `dist/index.d.ts` / `dist/index.js` / `dist/index.cjs` (lines 9-15)
- `"files": ["dist", "templates", "README.md", "LICENSE"]` (lines 16-21) — note `package.json` itself and `LICENSE` are always included by npm regardless of `files`, so this array is effectively correct as-is, but has never been verified via `npm pack`.
- `"version": "0.1.0"` (line 3), no CHANGELOG.md exists in the repo yet.
- `"prepublishOnly": "npm run build"` (line 30) — good, guards against publishing stale `dist/`.

`.github/workflows/ci.yml:31-49`, the `publish` job, runs on tag push (`startsWith(github.ref, 'refs/tags/v')`), builds, and runs `npm publish --provenance --access public` against `secrets.NPM_TOKEN`. This job has never fired (no `v*` tag has been pushed) and there is no `NPM_TOKEN` secret configured — confirmed live during this planning pass:

```
$ npm view @loop-eng/kit
npm error code E404
npm error 404 Not Found - GET https://registry.npmjs.org/@loop-eng%2fkit
$ npm whoami
npm error code ENEEDAUTH
```

The `@loop-eng` org does not yet exist on the npm registry (or at minimum this package under it does not), and no local/CI credentials are set up. Nobody has verified: (a) `npm pack` produces the intended tarball, (b) installing from that tarball actually exposes a working `kit` binary, (c) the two internal path-lookup tricks in the compiled output that assume "sibling `package.json`/`templates` directory" (`src/cli/index.ts:10-23` `loadVersion()`, `src/templates/registry.ts:9-27` `getBuiltinTemplatesDir()`) resolve correctly from inside `node_modules/@loop-eng/kit/` rather than only from the repo's own `dist/../package.json` layout during local dev.

---

## 2. CI Matrix Proposal

### Recommendation: reduced cross-product, not full 3×2

Full cross-product (3 OS × 2 Node versions = 6 jobs) is not worth it for a CLI this size. GitHub-hosted `macos-latest` runners bill at **10x** the per-minute rate of Linux, and `windows-latest` at **2x** ([GitHub Actions billing docs](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions)); on a public repo these are free, but they still slow down PR feedback (Windows/macOS runners commonly take 1.5-3x wall-clock time to provision and run npm installs). Kit is a single-package Node CLI with no OS-specific native addons (no `node-gyp`, no `.node` bindings) — the only OS-sensitive surface is `process.platform` branching in one function (`agent.ts`) and the shape of generated file paths, both of which are cheap to verify without a full matrix on every commit.

Proposed policy: **run the full test suite on all three OSes for the newest supported Node (22), and run only on Linux for the older supported Node (20)** — the "full matrix on latest, single-OS on the rest" pattern.

```yaml
jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          # Full OS coverage on the primary/newest Node version
          - os: ubuntu-latest
            node-version: 22
          - os: macos-latest
            node-version: 22
          - os: windows-latest
            node-version: 22
          # Older supported Node version: Linux only (fast signal, catches
          # engine-range regressions without tripling the cost)
          - os: ubuntu-latest
            node-version: 20
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run build
      - run: npm run test
```

**Exact diff against the current `ci.yml`:**

```diff
 jobs:
   build:
-    runs-on: ubuntu-latest
     strategy:
+      fail-fast: false
       matrix:
-        node-version: [20, 22]
+        include:
+          - os: ubuntu-latest
+            node-version: 22
+          - os: macos-latest
+            node-version: 22
+          - os: windows-latest
+            node-version: 22
+          - os: ubuntu-latest
+            node-version: 20
+    runs-on: ${{ matrix.os }}
     steps:
       - uses: actions/checkout@v4
       - uses: actions/setup-node@v4
         with:
           node-version: ${{ matrix.node-version }}
           cache: npm
       - run: npm ci
       - run: npm run typecheck
       - run: npm run lint
       - run: npm run build
       - run: npm run test
```

This is 4 jobs instead of the current 2 (or a naive full cross-product's 6). `fail-fast: false` is added so a Windows-only failure doesn't cancel the macOS/Linux legs mid-flight, which matters here because Windows is exactly the leg most likely to surface a real, actionable failure.

### Should the bash-based E2E suite run in CI at all, and on which OS?

`demo/test_e2e.sh` is not currently invoked by `ci.yml`. Two independent decisions:

1. **Wire it into Linux CI regardless of the Windows question** — this is a pre-existing gap unrelated to cross-platform work; 39 E2E tests exist and run zero times in CI today. Add a step to the `ubuntu-latest`/Node-22 leg (or its own job) running `bash demo/test_e2e.sh`. Low effort, should not wait for Phase 4 to land, but is naturally bundled here since it's the same YAML file.
2. **Do not expect it to run unmodified on `windows-latest`.** GitHub's `windows-latest` runner does ship Git for Windows, meaning a `bash` binary (Git Bash, MSYS) is on `PATH` and `shell: bash` works in Actions — so `test_e2e.sh` could technically be pointed at the Windows runner via `shell: bash`. **This would produce a false sense of security**: it proves the script works under Git Bash on a CI-provisioned Windows box, not that a real end user's plain Windows install (no Git for Windows, no WSL) can execute `.loop/verify.sh`. Recommendation: keep `test_e2e.sh` Linux (+ optionally macOS) only; do not run it on `windows-latest`, and do not treat a green Windows CI run as proof that the generated hook is runnable on all Windows machines — call this out explicitly in the CONTRIBUTING/README so nobody over-trusts a future green Windows CI badge.

---

## 3. Windows Compatibility Decision

### Recommendation: (a) now, with a cheap runtime guard, and (b) scoped as a fast-follow — not a blocker for v1.0.0

**Research finding (current as of this writing, July 2026):** the three agent CLIs Kit targets have all moved toward native Windows support, but in a way that keeps bash relevant rather than eliminating it:

- **Claude Code**: no longer requires WSL. The native Windows installer works via PowerShell. Critically, per Anthropic's own docs, *"when Git for Windows is installed, Claude Code uses Git Bash as its shell for better bash command compatibility; without it, Claude Code falls back to PowerShell."* A native PowerShell tool shipped in v2.1.84 (March 2026) as an *additional* option, not a replacement — Bash remains a first-class path, gated behind whether Git for Windows is present.
- **Codex CLI**: supports native Windows (PowerShell, AppContainer sandbox) and WSL2 (WSL1 dropped as of Codex 0.115). OpenAI's own recommended Windows dev setup explicitly includes installing Git via `winget`.
- **Gemini CLI**: lists "Bash, Zsh, or PowerShell" as supported shells; WSL is recommended for "better compatibility" but not required.

The upshot: **Git for Windows is not guaranteed**, but it is extremely likely to already be present on any Windows machine capable of using Kit in the first place, because (1) Kit's own detection (`agent.ts`) and generation logic assume a git-tracked project (`ensureGitignore` in `git.ts` reads/writes `.gitignore`), (2) all three target agent CLIs either recommend or actively prefer Git for Windows for their own bash compatibility, and (3) a developer without Git installed at all is an edge case even on Windows. This makes the failure mode "Windows user has no bash at all" real but narrow — not the common case, but not zero either (e.g., a user relying purely on the Codex/Claude native PowerShell path, having deliberately skipped Git for Windows).

Given that:

- **Option (a) — document as a prerequisite, ship now.** Add an explicit "Requirements" section to README.md stating: *"On Windows, the generated verification hook (`.loop/verify.sh`) is a bash script. Kit requires Git for Windows (provides Git Bash) or WSL to execute it. Both are already recommended/required by Claude Code, Codex CLI, and Gemini CLI on Windows, so most Windows users of these agents already satisfy this."* This is truthful, cheap (docs-only), and directly reuses the research above instead of asserting an untested guarantee.
- **Add a near-zero-cost runtime guard** (small, but still a code change — scope it as a follow-up PR, not part of this planning doc's "no code" constraint, and call it out as the one concrete code recommendation this plan makes): in `src/cli/init.ts`, after generating the hook files, if `process.platform === "win32"`, run the existing `commandExists("bash")` (the function already exists in `agent.ts` and would need to be exported/reused) and if it returns `false`, print a `p.note(...)`-style warning: *"No bash found — the generated .loop/verify.sh cannot run until you install Git for Windows or WSL."* This turns a silent, confusing failure (agent runs the loop, hook never executes, verification silently "passes" or the harness errors unhelpfully) into an actionable message at generation time, for the ~1 line of new logic it costs. This is the single highest-leverage, lowest-effort mitigation available and should be prioritized over (b).
- **Option (b) — dual-script generation — is feasible but should be a fast-follow, not v1.0.0-blocking.** Scoping it out (see below) shows it's more tractable than it first appears, because every current template's verify command (`src/templates/*.yaml`, e.g. `tsc --noEmit`, `npx vitest run`, `pytest`, `go test ./...`, `npm audit`) is a single plain command invocation with no bash-specific syntax (no `$(...)`, no pipes, no here-docs, no `[[ ]]` tests). A `.ps1` translation of `generateHooks()`'s control flow (run command, capture exit code, branch on 0 vs. non-zero, print colored pass/fail) is mechanical for this command shape. The risk is **user-supplied custom commands** (`answers.customCommand` from `src/cli/init.ts`'s "Custom command" verification option, per `FINDINGS.md` finding #12) — a user could type a bash-only command (`grep -q foo <(cmd)`, `&&`-chained multi-step pipelines with bash-only builtins) that has no clean PowerShell equivalent. Any dual-generation approach must accept that custom commands might not translate and should degrade to "generate bash only, warn if on Windows without bash" for that path.

**Do not pursue (c) "some other mitigation"** beyond what's folded into (a) above (the runtime guard is really a refinement of (a), not a distinct third option) — e.g., shipping a Node.js-based cross-platform hook runner (replacing the generated shell script with a tiny generated `.mjs` file executed via `node`) was considered and rejected for this phase: it would require Kit to reinvent shell semantics (`&&`, `||`, pipes) that its own templates rely on, is a much larger surface change than either (a) or (b), and would still need testing on all three OSes from scratch. Worth a future issue, not this phase.

### Implementation sketch for Option (b) (scoped, not built)

If greenlit as a fast-follow:

1. **`src/generators/hooks.ts`**: add a sibling `generatePowershellHook(verifyCommand: string): string` that emits:
   ```powershell
   # Verification gate — runs after each agent iteration
   # Generated by @loop-eng/kit
   Write-Host "Running verification: <verifyCommand>"
   & <split verifyCommand into exe + args, or invoke via cmd /c>
   $exitCode = $LASTEXITCODE
   if ($exitCode -eq 0) {
     Write-Host "✓ Verification passed"
   } else {
     Write-Host "✗ Verification failed (exit code: $exitCode)"
     exit $exitCode
   }
   ```
   Simplest correct approach: shell out via `cmd /c "$verifyCommand"` (or `& cmd /c $verifyCommand`) rather than trying to parse/re-tokenize the command string for native PowerShell invocation — this sidesteps quoting differences between the two shells entirely and keeps `generatePowershellHook` a thin wrapper, at the cost of still ultimately depending on `cmd.exe`'s (not bash's) quoting rules for anything with embedded quotes. Escaping needs its own helper (`verifyCommand.replace(/"/g, '\\"')` at minimum), mirroring the existing single-quote escaping done for bash (`hooks.ts:2`).
2. **`src/generators/index.ts`**: in `generateAll()`, when `process.platform === "win32"` (or unconditionally, writing both — see below), also write `.loop/verify.ps1` and, when the target agent is `claude-code`/`cursor`, `.claude/hooks/verify.ps1`. `chmodSync` is a no-op concern on Windows (no POSIX permission bits) so it can be skipped for the `.ps1` path.
3. **Decision needed**: write `.ps1` only on Windows (`process.platform` at *generation* time), or always write both files regardless of the machine running `kit init`? The latter is more correct for teams with mixed OS developers (someone on macOS runs `kit init`, a Windows teammate later runs the loop) but doubles every "Generated Files" table entry in the README and every `kit score` check (`src/cli/score.ts:106-107` currently checks for `.loop/verify.sh` OR `.claude/hooks/verify.sh` existing — would need a third OR-branch, or OS-aware scoring). Recommend: **always generate both**, since generation is cheap and it removes the OS-of-the-generating-machine as a variable — but this needs the `agent.ts` config templates and CLAUDE.md generator (`src/generators/claude-md.ts`) to reference the right one per-OS, or reference both and let the agent runtime pick.
4. **Templates/CLAUDE.md generators** (`generateClaudeMd`, `generateCodexMd`, `generateGeminiMd` in `src/generators/*.ts`) currently hardcode the hook path as a single string reference — these need to either mention both paths conditionally or leave OS selection to the agent (agents already read shell context and could be told "run `.loop/verify.sh` on macOS/Linux or `.loop/verify.ps1` on Windows").
5. **Testing**: needs new unit tests for `generatePowershellHook` (exit code branching, quote escaping) mirroring the existing `hooks.ts` test file, plus a Windows CI leg (already proposed in §2) actually invoking the generated `.ps1` via `pwsh -File` to prove it runs, not just that it typechecks/lints as a template string.

Effort estimate for (b) alone: **1-2 days** (generator + tests + doc updates + wiring into `score.ts`/CLAUDE.md templates), assuming the `cmd /c` shortcut is accepted rather than a "real" PowerShell-native translation.

---

## 4. npm Publish Dry-Run Procedure

Run these **in order**, on a clean checkout, before ever running the real `npm publish`. All commands assume `cwd` is the repo root and `package.json`'s current version is whatever is about to ship (bump first if needed — see §5).

```bash
# 1. Clean build from scratch — make sure nothing stale leaks into the tarball
rm -rf dist node_modules
npm ci
npm run build

# 2. Inspect exactly what npm would publish, without publishing anything
npm pack --dry-run
# Read the "Tarball Contents" list in the output carefully. Confirm:
#   - dist/cli.js, dist/index.js, dist/index.cjs, dist/index.d.ts, dist/index.d.cts present
#   - templates/*.yaml present (all 6)
#   - README.md, LICENSE present
#   - package.json present (always included, not listed in "files" but always shipped)
#   - NOTHING from src/, demo/, context/, .github/, node_modules/, *.test.ts,
#     coverage/, tsconfig.json, eslint.config.js, tsup.config.ts, vitest.config.ts
#     (none of these are in the "files" array, so they should NOT appear —
#      verify this assumption rather than trusting it)

# 3. Produce the actual tarball (does not touch the registry)
npm pack
# Produces something like loop-eng-kit-0.1.0.tgz in the repo root

# 4. Install FROM the tarball into a throwaway global prefix — do not
#    pollute your real global npm install
mkdir -p /tmp/kit-publish-check/global
npm install -g "$(pwd)/loop-eng-kit-0.1.0.tgz" --prefix /tmp/kit-publish-check/global

# 5. Put the throwaway global bin on PATH for this shell only
export PATH="/tmp/kit-publish-check/global/bin:$PATH"

# 6. Verify the bin resolves and --version matches package.json
which kit
kit --version
# Must print the exact version from package.json, not "0.0.0"
# (0.0.0 would indicate loadVersion()'s package.json lookup, src/cli/index.ts:10-23,
#  fails to find a matching package.json from inside node_modules/@loop-eng/kit/ —
#  this is the single most important thing this whole procedure is checking for)

# 7. Run kit end-to-end against a scratch directory, non-interactively
mkdir -p /tmp/kit-publish-check/scratch && cd /tmp/kit-publish-check/scratch
git init -q   # some detectors/gitignore logic expects a project dir; harmless if not
kit init --yes
ls -la CLAUDE.md .loop .claude 2>/dev/null
cat .loop/verify.sh   # confirm the hook content generated correctly from the packaged templates
kit score
kit templates
kit templates --search security

# 8. Confirm templates actually loaded from the packaged templates/ dir, not
#    accidentally from a dev-machine path (this is what getBuiltinTemplatesDir(),
#    src/templates/registry.ts:9-27, is for — prove it resolves correctly
#    from inside node_modules/@loop-eng/kit/dist/)
kit templates | grep -c "fix-types\|fix-lint\|add-tests\|migrate-api\|dependency-update\|security-audit"
# Should print 6

# 9. Clean up
cd -
npm uninstall -g @loop-eng/kit --prefix /tmp/kit-publish-check/global
rm -rf /tmp/kit-publish-check "$(pwd)/loop-eng-kit-0.1.0.tgz"
```

**Do this on at least two OSes before the real publish** (Linux is not sufficient given §3's findings) — ideally run this exact procedure by hand on a macOS machine and inside a Windows VM/CI job once, in addition to whatever the CI matrix from §2 automates. The CI matrix proves `npm run build && npm run test` passes per-OS; it does **not** prove the *packaged* artifact behaves correctly per-OS, because `npm run test` runs against `src/`/compiled-in-place `dist/`, not against a tarball installed into `node_modules`. Consider adding a dedicated `pack-check` CI job (Linux is fine for automation; the manual multi-OS pass above is the real gate for the first release) that runs steps 1-3 and 6-8 above as an actual CI step, failing the build if `kit --version` doesn't match `package.json`'s version or if template count isn't 6. This is cheap to add and catches regressions on every PR going forward, not just at release time.

---

## 5. Versioning Strategy Recommendation

**Recommendation: manual `npm version` + hand-maintained `CHANGELOG.md` (Keep a Changelog format) + git tag push. Do not adopt changesets or semantic-release.**

Reasoning:

- Kit is a **single-package repo**, not a monorepo. Changesets exists specifically to solve coordinated versioning across multiple packages in one repo; it adds a CLI dependency, a `.changeset/` directory workflow, and a PR-comment bot convention for a problem Kit doesn't have.
- semantic-release automates version bumps from Conventional Commits — worth it for high-velocity projects with many contributors where nobody wants to manually decide "is this a minor or a patch." For a small, single-maintainer CLI, manual `npm version {patch,minor,major}` is one command and gives a human a deliberate checkpoint to also update the changelog and sanity-check the dry-run procedure in §4 before tagging.
- **Org precedent**: I checked the sibling Go projects for convention. `loopctl` (`/Users/rfirke/Downloads/AI Projects/Loop Engineering/loopctl/.github/workflows/ci.yaml`) and `loopguard` (`.../loopguard/.github/workflows/ci.yaml`) both use a `release` job gated on `startsWith(github.ref, 'refs/tags/v')`, delegating the actual release to GoReleaser — i.e., **the org-wide convention is "a human decides when to cut a release and pushes a `vX.Y.Z` tag; CI reacts to the tag."** Kit's existing `ci.yml` `publish` job already follows this exact pattern (`if: startsWith(github.ref, 'refs/tags/v')`, `.github/workflows/ci.yml:33`). Manual `npm version` (which bumps `package.json` and creates the git tag in one step) is the npm-native equivalent of this same convention — no new tooling needed to match the rest of the org.
- `loopguard` maintains a hand-written `CHANGELOG.md` in Keep a Changelog + SemVer format (confirmed by reading `loopguard/CHANGELOG.md`). Kit has no `CHANGELOG.md` yet. Recommend adding one now, seeded with a `[0.1.0]` entry backfilled from the existing commit history, to match this precedent before the v1.0.0 (or whatever the next tagged version is) release.

**Concrete workflow to document in CONTRIBUTING or README "Releasing" section:**

```bash
# 1. Ensure main is green (CI passing on the new matrix from §2)
# 2. Update CHANGELOG.md: move "Unreleased" entries under a new version heading
# 3. Bump version (creates a commit + annotated git tag vX.Y.Z automatically)
npm version minor   # or patch / major, per semver judgment call
# 4. Push both the commit and the tag
git push origin main --follow-tags
# 5. CI's publish job fires on the pushed tag, runs npm publish --provenance --access public
# 6. Manually verify on npmjs.com that the version + tarball contents look right
#    (this is the same tarball-contents check as §4, now confirming the real publish)
```

---

## 6. Pre-Publish Checklist

Everything below must be true before the *first* real (non-dry-run) `npm publish` for `@loop-eng/kit`:

**Package correctness**
- [ ] `npm pack --dry-run` output reviewed by a human; tarball contains exactly `dist/`, `templates/`, `README.md`, `LICENSE`, `package.json` — nothing from `src/`, `demo/`, `context/`, `.github/`, test files, or config files (`tsconfig.json`, `eslint.config.js`, `tsup.config.ts`, `vitest.config.ts`).
- [ ] Full dry-run procedure from §4 executed successfully on at least macOS and Linux (Windows strongly recommended given §3).
- [ ] `kit --version` from the packaged install matches `package.json`'s version exactly (not `0.0.0` fallback).
- [ ] `kit templates` lists all 6 built-in templates when run from the packaged install (proves `getBuiltinTemplatesDir()` resolves correctly outside the dev repo layout).
- [ ] `bin`/`exports`/`files` fields in `package.json` reviewed line-by-line against actual `dist/` output (confirm `tsup.config.ts`'s two build targets — `cli.{js}` and `index.{js,cjs,d.ts,d.cts}` — still match what `exports` promises).

**Docs**
- [ ] README.md accurate against current CLI behavior (commands, flags, generated file list) — spot-check against `src/cli/*.ts` since README examples can drift from code.
- [ ] README.md has an explicit OS/prerequisites section covering the Windows bash dependency from §3.
- [ ] CHANGELOG.md exists (see §5) with an entry for the version being published.
- [ ] LICENSE present and correct (confirmed present, MIT, copyright "Loop Engineering" — confirm this is the intended holder name before a public release makes it hard to quietly change).

**Repo/CI hygiene**
- [ ] No secrets or `.env`-style files ever accidentally tracked (`.gitignore` already excludes `.env`/`.env.local` — confirm nothing was committed before the ignore rule existed).
- [ ] CI matrix from §2 merged and green on `main` before tagging.
- [ ] `demo/test_e2e.sh` wired into CI (see §2) and passing.

**npm/registry access**
- [ ] `@loop-eng` org exists on npmjs.com (confirmed **not yet true** as of this planning pass — `npm view @loop-eng/kit` returns 404, and the org name itself isn't resolvable via `npm view @loop-eng` either).
- [ ] Publishing user/account is a member of the `@loop-eng` npm org with publish rights, or the org needs to be created first.
- [ ] `NPM_TOKEN` repo secret configured in GitHub Actions (referenced by `ci.yml:49` but not yet confirmed to exist) — must be an **automation token** (not a personal token tied to 2FA-per-publish) so the unattended CI `publish` job doesn't stall waiting for an interactive 2FA prompt.
- [ ] If the npm org/account enforces 2FA for publishing, confirm whether that's "2FA for login+writes" (compatible with CI automation tokens) vs. "2FA for every publish" (incompatible with unattended CI publish — would require switching to manual `npm publish` from a maintainer's authenticated machine instead of the CI job).
- [ ] `--access public` flag (already present, `ci.yml:47`) is correct and intentional for a scoped package (`@loop-eng/kit` defaults to private/restricted without it).
- [ ] First publish is treated as effectively irreversible in practice — npm allows unpublishing only within 72 hours and with restrictions; confirm the version number and package contents are final before running it for real, not just in the dry run.

**Version sanity**
- [ ] Decide before tagging whether the first public release should be `0.1.0` (as-is, signaling "still evolving") or bumped to `1.0.0` given the "path to v1.0.0" framing of this whole phase — this is a product decision, not a technical one, and should be made explicitly rather than by default.

---

## 7. Effort Estimate

| Item | Effort |
|---|---|
| CI matrix expansion (§2 YAML diff) | 15 min to write, ~1 CI run to validate (may surface real Windows/macOS failures needing follow-up fixes — budget 0.5-1 day contingency for those) |
| Wire `demo/test_e2e.sh` into CI (Linux only) | 15 min |
| README "Requirements" section (Windows bash prerequisite) | 15 min |
| Runtime bash-availability warning in `kit init` on win32 | ~1 hour (export `commandExists`, add check + `p.note` warning, one unit test) |
| npm publish dry-run procedure, executed by hand once (§4) | 1-2 hours (mostly waiting on installs; more if it surfaces bugs in `loadVersion()`/`getBuiltinTemplatesDir()`) |
| Add `pack-check` CI job automating §4 steps 1-3, 6-8 | ~1 hour |
| CHANGELOG.md seeded + "Releasing" doc section | ~1 hour |
| npm org creation + `NPM_TOKEN` secret setup | Unknown — depends on whether `loop-eng` npm org needs first-time creation and 2FA/automation-token setup; budget 0.5 day for account/org admin overhead outside engineering control |
| **Total (excluding Option (b) dual-script generation)** | **~1-1.5 engineering days**, plus unpredictable npm-org-admin time |
| Option (b) dual-script generation (fast-follow, not blocking) | 1-2 additional days, scoped in §3 |

## 8. Open Questions

1. **Is `0.1.0` → `1.0.0` the intended jump for this publish, or does "path to v1.0.0" mean several more 0.x releases first?** Affects §6's version-sanity checklist item and whether this phase's completion should itself trigger the first publish.
2. **Who owns the `@loop-eng` npm org, and does it already exist under a different account than the one available for this dry-run check?** The 404/ENEEDAUTH results in §1.3 only prove this local machine isn't set up — org existence needs confirming directly on npmjs.com by whoever holds admin access.
3. **Should `.claude/hooks/verify.sh` also be generated for `codex`/`gemini` targets, not just `claude-code`/`cursor`?** Unrelated to cross-platform work but noticed while reading `generators/index.ts:41` — out of scope here, flagging for a separate phase.
4. **If Option (b) is greenlit later, should `.ps1` generation be unconditional (always write both files) or OS-conditional at generation time?** §3's implementation sketch recommends "always," but this doubles the `kit score` / CLAUDE.md-reference surface and should be confirmed with whoever owns the generator code before implementation starts.
5. **Does the org want a `pack-check` CI job to block merges, or run informationally (non-blocking) at first** given it's new and might have false positives until proven stable across a few PRs?
