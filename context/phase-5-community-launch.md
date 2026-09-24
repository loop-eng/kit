# Phase 5: Community & Launch — Implementation Plan

Status: **planning only** — no code or docs written yet. This document is the spec for Phase 5 work; it should be reviewed before any of it is executed.

Scope: turn a working, tested, unpublished MVP (v0.1.0, 64 unit + 39 E2E tests, 30-finding audit trail, pushed to a public but unannounced repo) into a project that is (a) publishable to npm, (b) contributable-to by strangers, and (c) launched in a way that survives first contact with Hacker News / r/programming without embarrassing itself.

---

## 0. Grounding facts pulled from the repo (not assumptions)

These facts drive every recommendation below and are worth stating up front because several of them contradict the original `ideas/04-kit.md` spec:

- **No remote registry exists.** `src/templates/remote.ts` was never built. `src/templates/registry.ts` only has `getBuiltinTemplatesDir()` / `loadBuiltinTemplates()`, which resolve to the in-repo `templates/` directory (checked via two candidate paths for dev vs. built dist). There is no fetch-from-GitHub or fetch-from-npm code path today.
- **Template validation is looser than `Template` in `src/types.ts` implies.** The interface says `tags: string[]`, `verification: { command, description }`, and `agent_instructions: Record<string, string>` are all required. The actual runtime check in `loadBuiltinTemplates()` only enforces: `name` (string), `description` (string), `goal` (string), `verification.command` (string), `budget.suggested_usd` (number), `budget.suggested_iterations` (number). `tags` and `agent_instructions` are optional and default to `[]` / `{}` if missing. `verification.description` is **not checked at all** — a template missing it will load fine but produce `undefined` wherever that field is displayed. This is a real gap between the type and the loader that the template contribution guide must document accurately (documenting the type as gospel would tell contributors an untrue story).
- **`agent_instructions` keys must exactly match `AgentType`** (`"claude-code" | "codex" | "gemini" | "cursor"`, hyphenated, from `src/types.ts`) — the lookup in `src/generators/index.ts:81` is `template?.agent_instructions?.[answers.agent]`. `templates/fix-types.yaml` only defines `claude-code`, `codex`, `gemini` — it has no `cursor` key. That's not a bug (missing key just yields `null` → generator falls back to generic instructions in `generateClaudeMd`), but it means every existing built-in template is already "incomplete" against the 4-agent surface. Worth fixing opportunistically during Phase 5, and worth calling out explicitly in the contribution guide so new templates don't repeat the gap.
- **Six Tier-1 templates already ship** (`fix-types`, `fix-lint`, `add-tests`, `migrate-api`, `dependency-update`, `security-audit`) — matches the original spec's Tier 1 list exactly. The five Tier-2 templates (`daily-triage`, `pr-review`, `docs-sync`, `i18n-sweep`, `perf-audit`) do not exist yet anywhere in the repo.
- **No CONTRIBUTING.md, no CODE_OF_CONDUCT.md, no issue/PR templates exist.** `.github/` currently contains only `workflows/ci.yml`.
- **Not yet published to npm.** `package.json` version is `0.1.0`; `prepublishOnly` runs the build, so publishing mechanics are ready, but it's never been run.
- **Repo has zero stars, zero external contributors, zero users.** Every recommendation below is sized for that reality, not for a project that already has traction.

---

## 1. CONTRIBUTING.md outline

Single file at repo root (`CONTRIBUTING.md`), linked from the README. Kept short — this is a solo-maintainer project with no external contributors yet; an elaborate governance doc would be pure theater and would signal "process over substance" to the first few people who actually show up.

**Section-by-section:**

1. **Welcome / scope one-liner** — "Kit is a small, single-maintainer CLI. PRs are welcome, especially new templates (see below) and bug fixes. For anything larger (new agent support, new commands), open an issue first to discuss before writing code."
2. **Dev setup** —
   ```
   git clone https://github.com/loop-eng/kit.git
   cd kit
   npm install
   npm run build
   ```
   Node `>=20` requirement (from `package.json engines`), and note that `kit` is an ESM package (`"type": "module"`), which matters if a contributor tries to add CJS-style code.
3. **Running the test suite** — reference actual scripts from `package.json`:
   - `npm run typecheck` (`tsc --noEmit`)
   - `npm run lint` (`eslint src/`)
   - `npm test` (`vitest run`) / `npm run test:watch`
   - `bash demo/trial.sh` and `bash demo/test_e2e.sh` for the interactive + E2E demo suites (already documented in README's Development section — CONTRIBUTING.md should point there rather than duplicate).
   State plainly: **a PR must pass typecheck, lint, and `npm test` before review.** CI (`.github/workflows/ci.yml`) enforces this already; mention that CI will run automatically on PR.
4. **Code style** — don't invent new rules; point at the two files that already encode them:
   - `eslint.config.js`: `@typescript-eslint/recommended`, `no-unused-vars` (error, `_`-prefixed args exempt), `no-explicit-any` is **off** (so `any` is allowed — don't tell contributors otherwise), `no-console` is a warning not an error.
   - `tsconfig.json`: `strict: true`, `noUnusedLocals`/`noUnusedParameters` on — code must compile clean under strict mode.
   - No Prettier/formatter is configured in the repo today — CONTRIBUTING.md should say so explicitly ("no auto-formatter is enforced; match the surrounding file's style") rather than imply a formatter exists.
5. **Commit / PR expectations** — kept minimal:
   - One logical change per PR.
   - PR description should state what changed and why (not just "fix bug").
   - No specific commit message convention is enforced (no Conventional Commits requirement) — don't invent one; the existing two commits in history (`kit v0.1.0 — loop scaffolding CLI`, `rewrite FINDINGS.md with honest categorization`) are plain descriptive sentences, so match that tone.
   - New behavior needs a test (unit in `src/**/__tests__`, or an E2E case in `demo/test_e2e.sh` if it's wizard-flow-shaped).
6. **What kinds of PRs are welcome vs. should be an issue first** — be explicit to avoid wasted contributor effort:
   - Welcome directly as PRs: new templates (link to template guide), bug fixes with a repro, doc fixes, new stack/test-runner auto-detection rules in `src/detectors/`.
   - Discuss in an issue first: new CLI commands, new agent support beyond the current 4, changes to the generated file layout (`.loop/`, `CLAUDE.md` format, etc.) since those are the project's public contract.
7. **Reporting bugs** — link to GitHub Issues, ask for: kit version, Node version, OS, command run, expected vs. actual. No formal issue template needed yet at this scale, but a **minimal** `.github/ISSUE_TEMPLATE/bug_report.md` (3 fields) is cheap enough to be worth it — see Section 8 effort estimate.
8. **License note** — contributions are under the project's MIT license (link to `LICENSE`).

Explicitly out of scope for v1.0 CONTRIBUTING.md (don't build): a CLA/DCO process, a governance/maintainers-team doc, a detailed branching strategy, a changelog format mandate. All of these are premature for a repo with zero contributors — add them if and when they become necessary friction points, not before.

---

## 2. Template contribution guide

Recommend a **standalone `templates/CONTRIBUTING.md`**, not a section buried in the root CONTRIBUTING.md. Reasoning: templates are the one contribution type this project is actively soliciting from strangers (the 5 deferred Tier-2 templates exist specifically to be community-sourced per the original spec), so it deserves its own discoverable file sitting right next to the YAML files it governs, and it can be linked from both the root CONTRIBUTING.md and the README's template section.

### 2.1 The real schema (verified against code, not just the example file)

Document two tiers of requirements, because the type and the loader disagree:

**Required to load at all** (enforced in `src/templates/registry.ts::loadBuiltinTemplates`; a template failing any of these is silently skipped — no error, no crash, just invisible):
| Field | Type | Notes |
|---|---|---|
| `name` | string | Used as the template's identifier (`kit init --template <name>`, `findTemplate`). Should be kebab-case to match existing templates (`fix-types`, `dependency-update`, etc.). |
| `description` | string | Shown in `kit templates` listing. |
| `goal` | string | Freeform multi-line text, becomes the agent's task description. |
| `verification.command` | string | Shell command the generated `verify.sh` runs. |
| `budget.suggested_usd` | number | Must be a YAML number, not a quoted string. |
| `budget.suggested_iterations` | number | Same. |

**Required by the `Template` TypeScript interface but NOT enforced by the loader** (a template can omit these and will still load, but will render `undefined`/empty in places that expect them — contributors should still fill these in for a template to actually be useful, but the guide should be honest that omitting them won't cause a visible error):
| Field | Type | Notes |
|---|---|---|
| `tags` | string[] | Defaults to `[]` if missing. Used by `kit templates --search`. Without tags, the template is invisible to search (only matches on name/description substring). |
| `verification.description` | string | Human-readable explanation shown alongside the command. Not validated — a missing value silently renders as blank/undefined. |
| `agent_instructions` | `Record<string, string>` | Defaults to `{}` if missing — the template will still work, it just adds no agent-specific instructions (generators fall back to their generic template). |

**Key format for `agent_instructions`** — this is the one place the guide must be precise, because getting it wrong produces no error, just silently-ignored content: keys must be exactly one of `claude-code`, `codex`, `gemini`, `cursor` (matching `AgentType` in `src/types.ts`, hyphenated — **not** `claude_code` with an underscore, which is what the original `ideas/04-kit.md` example uses and is wrong against the current code). A typo'd key (e.g. `claude`) is not an error — it's just dead weight in the YAML that never gets read. Contributors should provide all four keys where the instructions genuinely differ per agent, or omit the block per-agent if the generic fallback is good enough. Recommend that new templates include at minimum `claude-code` and one other agent, since `claude-code` and `cursor` currently share the same generator path (`generateClaudeMd`) and the other two agents (codex, gemini) get materially different generators — leaving those two blank means those agents get zero template-specific guidance.

### 2.2 Full annotated example (based on `templates/fix-types.yaml`, corrected)

```yaml
# templates/your-template-name.yaml
name: your-template-name          # required, kebab-case, must be unique
description: "One sentence describing the task"   # required
tags: [tag1, tag2, common]        # optional but strongly recommended for discoverability
goal: |                            # required — multi-line task description for the agent
  Describe the task in imperative form. Be specific about what
  "done" looks like and what NOT to do (e.g. don't suppress errors).
verification:
  command: "npx some-check"       # required — must exit 0 on success, nonzero on failure
  description: "What passing this command means"   # not enforced, but fill it in
budget:
  suggested_usd: 10                # required, number not string
  suggested_iterations: 10         # required, number not string
agent_instructions:                # optional block; optional per-key
  claude-code: |
    ## Loop Instructions
    - ...
  codex: |
    ...
  gemini: |
    ...
  cursor: |
    ...
```

### 2.3 Submission process

Confirmed against `getBuiltinTemplatesDir()`: templates are loaded from the repo's own `templates/` directory (resolved relative to the installed package — `dist/../templates` in production, `src/../templates` in dev). **There is no separate remote registry to publish to.** The only way to add a template today is a PR that drops a new `.yaml` file into `templates/` in this repo. The guide should say this plainly: "Open a PR adding `templates/<name>.yaml`. There is no separate registry — once merged and released, your template ships inside the `@loop-eng/kit` npm package itself."

Steps to document:
1. Copy an existing template (`templates/fix-types.yaml` is the best-documented reference) as a starting point.
2. Fill in all fields from 2.1, including the ones that aren't strictly enforced.
3. Run `kit templates --search <your-tag>` locally (after `npm run build`) to confirm it's discovered and parses correctly.
4. Add/extend a unit test in `src/templates/__tests__/` (if a test file for registry loading exists — verify and reference the actual path) asserting the new template loads and validates.
5. Open a PR against `templates/` only (or `templates/` + tests) — no source code changes needed for a pure template addition, which keeps review small and fast.

### 2.4 Review criteria (what a maintainer checks before merging)

- Loads without error (`kit templates` shows it).
- `verification.command` is a real, runnable command that actually fails on failure (this project's own audit trail — `FINDINGS.md` findings #13, #11 — is full of "verification silently exits 0" bugs; don't let a new template reintroduce that class of bug via a bad command).
- `goal` is specific enough that an agent won't need to guess scope (compare against the specificity of the 6 existing Tier-1 templates).
- No secrets, no destructive commands (`rm -rf`, force-push, etc.) as the suggested verification or goal text.
- Tags are lowercase, reuse existing tag vocabulary where sensible (`typescript`, `fix`, `common`, `security`, etc.) rather than inventing near-duplicates.
- Prefer templates that map to the 5 deferred Tier-2 tasks (`daily-triage`, `pr-review`, `docs-sync`, `i18n-sweep`, `perf-audit`) first, since those are the explicitly-promised gap — but don't reject a good template outside that list.

---

## 3. Remote registry decision

**Recommendation: do NOT build `src/templates/remote.ts` for v1.0. Ship v1.0 with "contribute via PR to `templates/`" only.**

Reasoning:
- There is zero evidence of contributor demand yet — the repo has no stars, no issues, no external PRs. Building fetch-from-GitHub or fetch-from-npm infrastructure (auth-free fetching, caching, version pinning, trust/security review of arbitrary remote YAML being parsed and later shell-executed via `verification.command`) is real engineering effort spent on a problem that doesn't exist yet.
- A remote registry introduces a **security surface that doesn't exist today**: templates' `verification.command` and `goal` text end up feeding a generated `verify.sh` that gets executed. In-repo templates go through this project's own PR review. A remote-fetch design means kit would be downloading and later shell-generating from YAML authored by strangers with no review gate, at install- or run-time. That's a meaningfully bigger trust and security design problem (arbitrary command suggestions, supply-chain risk) than "review a 6-field YAML file in a PR." Building this prematurely, before there's a real community to serve, is the kind of unforced risk a security-conscious v1.0 should avoid.
- The in-repo model already matches how the 6 shipped templates work today, requires zero new code, and scales fine up to dozens of templates — `claude-code-templates` (28.4K stars) ships hundreds of templates in-repo/in-package and only more recently grew catalog/browser tooling on top; it didn't need a remote fetch layer to get there.
- If/when template count or contribution velocity actually creates friction (e.g., PR review becomes a bottleneck, or the package size from bundling many templates becomes a real complaint), a remote registry is a clean **v1.1+** addition that doesn't require re-architecting anything — `getBuiltinTemplatesDir()` and `loadBuiltinTemplates()` can be extended with an additional remote source later without breaking the built-in path.

What to do instead for v1.0: make the in-repo contribution path as frictionless as realistically possible (Section 2), and set an explicit trigger condition for revisiting this decision — e.g., "if templates/CONTRIBUTING.md produces 10+ community-submitted templates in a quarter, or if users repeatedly ask for private/org-specific template sources, reopen the remote registry question."

This directly overrides the original `ideas/04-kit.md` Phase 3 line ("Remote template registry (community templates via npm or GitHub)") — that line should be treated as superseded by this decision, not as a v1.0 requirement.

---

## 4. Launch asset plan

### 4.1 Demo format: asciinema primary, GIF fallback

Recommend **asciinema recording, converted to an SVG/GIF fallback embedded in the README, with a link to the live asciinema player for the full-fidelity version.**

Tradeoffs (for the record):
- **Asciinema**: tiny file size (text-based cast format), crisp text at any zoom, copy-pasteable output, plays at actual terminal speed with pause/seek. Downside: doesn't render inline in GitHub's README preview without extra tooling — it's an embed/link, not a native Markdown image.
- **GIF**: renders natively in every Markdown preview (GitHub, npm's README render, Show HN link-preview tools that screenshot pages, Reddit's inline preview), zero extra clicks for a skimming visitor. Downside: large file size, blurry/aliased text at typical GIF color-depth, no copy/seek, has to be re-recorded (not just re-rendered) if terminal content changes.
- Given the top-of-funnel channels for this launch are Show HN and r/programming — both of which are read by people skimming a README in a few seconds, not people who reliably click through to an embedded player — the GIF (or GIF-rendered-from-asciinema, e.g. via `agg` / `asciicast2gif`) needs to be the thing that's actually visible above the fold in the README. The asciinema cast is the higher-fidelity artifact worth linking for anyone who wants to see real timing/interaction, and it's useful to embed in the GitHub repo's "About" or in a docs site later, but it should not be the *only* demo asset.
- Concretely: record once with asciinema (`asciinema rec demo.cast`), render a GIF from that same recording with `agg` (asciinema's own GIF renderer, keeps text crisp better than a screen-capture GIF), embed the GIF in the README, and link the `.cast` file (hosted on asciinema.org, free) as "Watch the full recording" underneath. One recording, two outputs, no duplicated effort.
- Keep it short: 15-20 seconds, one full `kit init` wizard run with realistic-looking answers, ending on the "Files created" success state already shown in the current README.

### 4.2 README above-the-fold structure

The current README (`/Users/rfirke/Downloads/AI Projects/Loop Engineering/kit/README.md`) already has good bones — title, one-liner, badges (CI, npm version, license), problem, solution with wizard transcript. For launch, the above-the-fold section (everything before "Features") should be tightened to, in order:

1. **Title + one-liner** (already correct: "Create production-ready agent loops in 30 seconds").
2. **Badges** — keep CI/npm/license, but note the npm badge will show nothing meaningful until publish (Section 5) — sequence matters here.
3. **The GIF demo**, moved up to sit directly under the badges, *before* the "Problem" prose — a skimming visitor decides whether to keep reading based on the demo, not the pitch. Currently the README shows a static wizard transcript in a code fence; replacing/supplementing that with the actual animated GIF is the single highest-leverage README change for launch.
4. **One-line install command** (`npx @loop-eng/kit init`) directly under or beside the demo — don't make a visitor hunt for it in the Installation section further down.
5. Then the existing "The Problem" / "The Solution" prose can follow.
6. Add a **"Why kit" or differentiation line** near the top (not buried in the Competitive Landscape table near the bottom) — one sentence, e.g. "Unlike general scaffolders, kit generates verification gates and budget caps, not just config files" — because that's the actual differentiator and it shouldn't require scrolling to a table to find it.

Don't add: a logo/mascot, a "Sponsors" section, a docs-site link (none exists) — these would be surface polish disproportionate to an unlaunched single-maintainer CLI, and an observant HN/r/programming audience notices over-produced README theater on a 2-commit repo.

### 4.3 Show HN / r/programming title and post angle

The competitive table already in `ideas/04-kit.md` is the sharpest asset available — spec-kit (111K stars) and claude-code-templates (28.4K stars) dwarf kit, so the post must not compete on "another scaffolder" territory; it must stake out the specific gap.

**Angle**: kit is not a config/prompt template catalog (claude-code-templates) and not a general spec-driven-development framework (spec-kit). It's the only one of the four tools in the table that generates an enforceable **runtime contract** — a verification gate that must pass, a budget cap, and convergence/stall detection — rather than a static file. The honest hook is: "most AI coding agent scaffolders configure what to tell the agent; kit configures how to stop it" (runaway loops, silent verification failures, unbounded cost are the actual pain, not "which markdown template do I start from").

Draft title options (angle, not final copy):
- "Show HN: Kit — scaffolds budget caps and verification gates for AI coding agent loops, not just prompts"
- "Show HN: I got tired of AI agents running forever with no verification, so I built a scaffolder that enforces stop conditions"

Post body should emphasize, in order:
1. The specific failure mode kit prevents (runaway/silent-pass loops) — anchor in something concrete and slightly self-deprecating/credible, e.g. citing the project's own `FINDINGS.md` bug where a bad verification script exited 0 silently — this is a genuinely good, honest anecdote: *the exact bug class kit exists to prevent was found and fixed in kit's own generator during a self-audit.* That's a much stronger credibility signal than generic marketing copy, and it's true.
2. What it actually generates (be concrete: CLAUDE.md, budget.yaml with real thresholds, verify.sh, LTF trace config) rather than "loop configs."
3. Cross-agent support (4 agents) as a secondary point, not the lead — spec-kit already "wins" on agent breadth (30+), so competing there is a losing frame.
4. A direct, honest acknowledgment that this is a brand-new, single-maintainer project (0.1.0, first public release) — HN audiences respond better to calibrated humility than launch-hype, and it's true.
5. Link to `FINDINGS.md` explicitly in the post as evidence of engineering rigor — a documented 30-finding audit with honest severity-downgrades (not just "we fixed bugs" but "we also admitted when a finding was overstated") is an unusually credible artifact for a solo side project and is worth surfacing directly rather than hoping people find it.

Do not lead with LTF integration or the broader "Loop Engineering ecosystem" (loopguard/ltf/loopctl) in the launch post — that's an ecosystem pitch that asks a skimming reader to absorb multiple unfamiliar projects at once. Mention it once, briefly, as "part of a small suite of loop-engineering tools," and let interested readers click through.

---

## 5. Publicity sequencing

Recommended order, with reasoning for why order matters here specifically (zero existing users means the first real users are also the first bug reporters — sequence to make that safe):

1. **Finish Phase 5 deliverables first** (CONTRIBUTING.md, template guide, README above-the-fold rework, demo asset) — landing these before any announcement means the first external visitor from any channel sees a finished-looking project, not a work-in-progress.
2. **`npm publish` (as `0.1.0` or bump to `1.0.0` — see open questions) before any public announcement.** Reasoning: Show HN / Reddit posts reliably drive people to try `npx @loop-eng/kit init` within seconds of reading the post; if the package isn't on npm yet, the very first thing every visitor does fails immediately. Publishing must precede any traffic-driving step by definition, not just in spirit.
3. **Soft-launch to a small, low-stakes audience before the big public posts.** Concretely: post in one or two Discord/Slack communities where Claude Code / Codex / Gemini CLI power users already congregate and self-select for exactly this problem (e.g., the Anthropic/Claude Code community Discord, an "AI coding agents" or "agentic engineering" Discord that's already active in this space) with a low-key "I built this, would love feedback" framing rather than a launch announcement. This is a much better first audience than HN because: (a) it's a warmer, more forgiving crowd for a v0.1 with rough edges, (b) it's the exact target user (people already running Claude Code/Codex/Gemini loops), and (c) feedback here is fixable before a much larger, less forgiving audience sees it. Budget a few days here specifically to catch install issues, wizard UX confusion, or auto-detection false-negatives that internal testing wouldn't surface (different OSes, different repo shapes, different Node versions).
4. **Fix whatever the soft-launch surfaces** — treat this as a real gate, not a formality. Given the project's own audit history (FINDINGS.md shows real bugs were still being found on the 3rd internal audit pass), it would be surprising if the first batch of real external users found nothing.
5. **Then Show HN and r/programming**, timed for the posting windows those platforms are known to reward (HN: weekday mornings US Eastern tend to get better sustained visibility than weekends; r/programming similarly favors weekday US-hours posting) — post to HN first (higher signal, faster feedback loop, comments are more technical) and r/programming a day or two later rather than simultaneously, so that if HN surfaces a sharp critical bug, it's fixed before the second audience arrives.
6. **Do not cross-post identically.** Reddit and HN audiences both notice and penalize copy-pasted launch posts; tailor tone slightly (HN: terser, more technical, lead with the failure-mode anecdote; r/programming: can be slightly more narrative/blog-style if a companion post exists).

This is a sequence, not a single day — realistically spans 1-2 weeks from "Phase 5 code/doc complete" to "r/programming post," which is consistent with the original spec's own Week 2 target for npm publish and leaves room for the soft-launch step that the original spec skipped entirely.

---

## 6. Realistic success metrics — assessment of the original targets

Original targets (`ideas/04-kit.md`, Success Metrics):
- Month 1: 300+ npm weekly downloads, 200+ GitHub stars
- Month 3: Community template contributions, 1,000+ stars

**Assessment: the star targets are not well-calibrated against the competitive data already gathered in the same document, and should be revised down.** The document's own table shows:
- spec-kit: 111K stars — a Microsoft/GitHub-backed project with major-account distribution advantages no solo side project has access to. Explicitly an outlier; should never have been used as an implicit calibration point.
- claude-code-templates: 28.4K stars — also a large, well-promoted catalog project, not a fair comparator for a brand-new single-maintainer tool.
- **dotforge: 301 stars, mex: 1.1K stars, ai-devkit: 1.5K stars** — these are the actually-comparable projects: narrow-scope, single-purpose CLI tools in the same broad space, likely built by individuals or small teams. These are the right reference class.

Against that reference class, **1,000+ stars by Month 3** is optimistic-to-unrealistic for a first release with no prior audience, no existing brand, and no institutional backing — mex (a plausible multi-month-to-multi-year project) sits at 1.1K, and that's treated in the competitive table as a *comparison point kit should exceed*, not a floor it should assume it'll hit in 90 days. **200+ stars by Month 1** is similarly aggressive — that's more stars in 30 days than dotforge appears to have accumulated over its whole lifetime, based on the numbers given.

The 300+ weekly npm download target is more plausible in isolation (a successful single HN front-page appearance alone can drive several hundred to low-thousands of one-time `npx` invocations, though "weekly sustained downloads" is a different and harder bar than "launch-week spike"), but it's contingent on stars/attention materializing first, which the above suggests is not guaranteed on this timeline.

**Revised targets, reasoning-anchored to the dotforge/mex/ai-devkit reference class rather than the spec-kit/claude-code-templates outliers:**

| Milestone | Original | Revised | Reasoning |
|---|---|---|---|
| Month 1 stars | 200+ | **30-75** | A successful single Show HN front-page hit plus a soft-launch Discord post realistically nets low tens of stars for a new, unknown tool; treat 75 as a "great launch" outcome, not a floor. |
| Month 1 npm weekly downloads | 300+ | **50-150 sustained** (launch-week spike may be higher, one-time) | Distinguish spike from sustained; sustained weekly downloads require repeat/organic use, which takes longer than a launch week to establish. |
| Month 3 stars | 1,000+ | **150-400** | Positions kit as having meaningfully outpaced dotforge (301) if it clears ~300-400, which is a genuinely good, defensible outcome — don't set the bar at "beat mex," set it at "beat dotforge, approach mex." |
| Month 3 community template contributions | "Community template contributions" (unquantified) | **1-3 external template PRs** | Given the reference-class star counts, expecting a flood of community PRs by Month 3 is inconsistent with those same tools' likely contributor counts. 1-3 real external contributions by Month 3 would be a solid, credible signal that the contribution path (Section 2) works, without assuming viral growth that hasn't happened for comparable tools. |

Recommend keeping the *shape* of the original metrics (downloads + stars + contributions, checked at 1 and 3 months) but replacing the numeric targets with the above, and explicitly noting internally that the original numbers appear to have been aspirationally anchored to the table's largest outlier rather than its comparable entries.

---

## 7. Effort estimate

| Deliverable | Estimate | Notes |
|---|---|---|
| `CONTRIBUTING.md` | 0.5 day | Mostly synthesis of already-documented dev commands; low novel content. |
| `templates/CONTRIBUTING.md` | 0.5-1 day | Requires the schema cross-check already done in this plan (Section 2.1) plus 1-2 worked examples; also fix the missing `cursor` key gap in existing Tier-1 templates while in there (small, separable follow-up). |
| README above-the-fold rework | 0.5 day | Reordering + trimming existing content; no new prose needed beyond the differentiation one-liner. |
| Asciinema recording + GIF render | 0.5-1 day | Includes a couple of retakes to get wizard answers/timing looking clean; `agg` install and GIF tuning may take a couple of iterations. |
| `.github/ISSUE_TEMPLATE/bug_report.md` (minimal) | <0.5 day | Optional but cheap; 3-field template. |
| npm publish dry run + actual publish | 0.5 day | Includes verifying `files` field in `package.json` actually packages `dist/`, `templates/`, README, LICENSE correctly (`npm pack --dry-run` check) before first real publish. |
| Soft-launch post + triage window | 2-5 days elapsed (low active effort, but needs to be *waited out*, not skipped) | Elapsed time, not work time — this is intentionally where the plan asks for patience over speed. |
| Show HN / r/programming post-writing | 0.5 day | Drafting from the angle in Section 4.3; should be written, not improvised same-day. |
| **Total active work** | **~4-5 days** | Plus the soft-launch elapsed window (2-5 days) sitting in the middle of the sequence — total calendar time roughly 1.5-2 weeks, consistent with Section 5's sequencing. |

---

## 8. Open questions (for review before execution)

1. **Version number at launch**: publish as `0.1.0` → `0.2.0` (incremental, honest about maturity) or jump to `1.0.0` for launch-day credibility? Given FINDINGS.md's own honest tone ("15 real bugs," self-graded severity), a `0.x` version that's upfront about pre-1.0 status may actually fit the project's credibility narrative better than a `1.0.0` that implies more stability than a 2-commit repo has earned. Recommend deciding this explicitly rather than defaulting to "1.0.0 because that's what launches are."
2. **Which Discord/Slack communities specifically** — this plan recommends a soft-launch to Claude Code / Codex / Gemini CLI-focused communities but does not have a verified, current list of specific server names/invite links; that needs a short research pass (which may turn up dead/inactive servers, access requirements, or self-promotion rules) before Section 5 step 3 can be executed concretely.
3. **Who fixes the `cursor` key gap in existing templates** — flagged in Section 0/2.2 as a small pre-existing inconsistency; worth a one-line decision on whether it's in-scope for Phase 5 or a fast-follow.
4. **Does `verification.description` need to become an enforced field** (closing the type/loader gap noted in Section 0), or is documenting the gap in the contribution guide sufficient for v1.0? This plan recommends documenting-not-enforcing for now (smaller change, no behavior risk before launch) but flags it as a legitimate small follow-up for whoever owns `src/templates/registry.ts` next.
5. **Asciinema hosting**: asciinema.org is free and simple, but confirm there's no objection to a third-party hosting dependency for the "full recording" link before committing to it in the README.
