# Phase 5 Community & Launch — Adversarial Review

**Role:** Independent skeptical reviewer. Planning only — no code changed to produce this document.

**Method:** Verified claims against the actual codebase (not just the pitch doc) as of 2026-07-27:
`src/types.ts`, `src/templates/registry.ts`, `src/generators/index.ts`, `src/generators/ltf-config.ts`,
`src/cli/*.ts`, `templates/*.yaml`, `FINDINGS.md`, `.github/workflows/`, `package.json`, `demo/test_e2e.sh`.

---

## 1. Launch-readiness gate assessment

**Verdict: YES — gate all outward-facing Phase 5 activity (Show HN, r/programming, npm `latest` announcement, "launch assets") on Phases 1–4 substantively closing the two gaps identified below. Do not gate the low-risk, reversible groundwork (CONTRIBUTING.md, template guide drafting, npm publish under a quiet 0.x tag).**

### Why the pitch is currently overclaimed, with receipts

The differentiation pitch in `ideas/04-kit.md` rests on five pillars: "(1) beautiful interactive wizard UX, (2) loop-specific output, (3) cross-agent support, (4) LTF trace integration, and (5) community template ecosystem." Two of these five do not hold up under inspection today:

- **LTF integration is a config stub, not an integration.** `src/generators/ltf-config.ts` emits a YAML file describing where traces *would* go (`.loop/trace.ltf.jsonl`, field toggles, retention policy). There is no code anywhere in `src/` that writes an LTF trace entry. `kit status` (`src/cli/status.ts`) reads a trace file if one happens to exist, but nothing in kit itself, and no documented integration with the actual `ltf` package, produces one. A user who runs `kit init`, then `claude`, then `kit status` will see "no trace found" — the flagship differentiator that competitors supposedly lack is, in the shipped product, inert scaffolding. Launching with "LTF-native" as a headline claim while the mechanism doesn't exist is the single biggest reputational risk in this plan: a technical reviewer who tries `kit status` immediately after following the README will find it broken, in public, on day one.

- **The interactive wizard has zero automated coverage of the interactive path.** There is no `src/cli/__tests__/` directory at all — `init.ts`, `score.ts`, `status.ts`, `template.ts` have no unit tests. The 39 E2E tests in `demo/test_e2e.sh` all invoke `kit init --yes` (grep confirms only one reference to "interactive" in that file, in a comment header) — meaning the actual `@clack/prompts` state machine (arrow-key navigation, the "Custom command" follow-up prompt fixed in FINDINGS.md #12, Ctrl+C handling fixed in #25) has never been exercised by CI. This is precisely the code path a Show HN visitor will run first, live, in their terminal, on a system/terminal-emulator combination the team hasn't tested. The 64+39=103 passing tests genuinely support "the generators are solid" — they do not support "the wizard is solid," and the marketing copy does not distinguish between the two.

### The core argument

Kit's differentiation claim is *specifically* about beating spec-kit (111K stars) and claude-code-templates (28.4K stars) on breadth-of-integration (wizard + loop primitives + cross-agent + LTF + templates) rather than on raw popularity or ecosystem size — a small project's only credible pitch against giants is "we do the whole thing well." If two of five claimed pillars are either non-functional (LTF) or unvalidated (wizard), a reviewer who pokes at either one publicly converts "no tool combines all five" into "this tool doesn't actually do two of the five it claims," which is a worse outcome than not launching yet. This is not a hypothetical concern — Show HN and r/programming commenters routinely `npx` a tool live in the thread within the first hour (see §2) specifically to test the headline claim.

Phases 1–4 are described as already "shipped" per project memory ("Phases 0-3 shipped" is loopctl, not kit — for kit specifically the working assumption from this review's parent context is Phase 1 LTF work and Phase 3 wizard-testing work are still in flight in parallel with this Phase 5 planning). Treating Phase 5 as independently parallelizable is the mistake to avoid: **launch messaging and code completeness are coupled by definition — you cannot credibly announce a capability that isn't wired up.** The safe sequencing is:

1. Phase 5 *planning and drafting* (this document, CONTRIBUTING.md, contribution guide, launch copy drafts) can proceed in parallel — it's cheap and reversible.
2. Phase 5 *execution* (opening a Show HN thread, posting to r/programming, tagging a `1.0.0` release, tweeting/posting launch assets) must be gated on:
   - **Gate A:** LTF integration either (a) actually writes trace entries during a `claude`/`codex`/`gemini` run kit orchestrates, or (b) the claim is downgraded in all launch copy and the README to "LTF-ready" / "emits an LTF-compatible trace config; wire-up to your agent's hooks is a few lines" — i.e., stop claiming the feature works end-to-end if it doesn't, either by finishing it or by being honest about its current scope.
   - **Gate B:** At minimum, smoke-test coverage of the interactive wizard path exists (even a small set of scripted `node-pty`-driven or Clack-mockable tests that exercise 2-3 real prompt sequences including cancel and the custom-command follow-up) so "launch-day bugs in the flagship UX" isn't a live risk during the traffic spike a launch produces — the worst time to discover a wizard crash is during a Show HN front-page spike, not before it.
3. Until both gates close, Phase 5 should proceed with **npm publish at 0.x** (quiet, no announcement) and repo-hygiene work only. This gets the "already npm published" credibility marker in place for whenever the public launch does happen, without the launch amplifying a known gap.

**Bottom line:** recommend "not yet" for public launch activities specifically (Show HN, r/programming, press-style copy). Recommend "yes, now" for CONTRIBUTING.md, contribution guide, and quiet npm publish, since those don't make claims that can be falsified live.

---

## 2. Messaging risk analysis

### The tagline is the highest-risk sentence in the whole project

> "Create production-ready agent loops in 30 seconds — zero to loop with one command."

This phrasing has three problems for a Show HN / r/programming audience in mid-2026, a period saturated with "AI agent" tooling launches and correspondingly high community fatigue and "vibe coding" skepticism:

1. **"30 seconds" is a speed/magic claim, not an engineering claim.** These communities have seen hundreds of "X in 30 seconds" AI tool posts; the number itself reads as marketing filler rather than a verifiable fact, and inviting a top comment of "cool, took me 45 seconds, checkmate" is a needless unforced error. It also isn't really true as a *loop* claim — running `kit init` takes ~30 seconds, but a "production-ready agent loop" implies the loop has actually been run and verified, which it has not at that point.
2. **"Production-ready"** is a strong, falsifiable claim for a tool at v0.1.0 with an admitted non-functional LTF path (see §1) and an untested wizard. If a commenter finds either gap, "production-ready" becomes the exact phrase they quote back mockingly.
3. **No mention of verification/rigor up front.** Kit's actual strongest asset for a skeptical technical audience — an honest, numbered audit trail (`FINDINGS.md`: 15 real bugs found and fixed across 3 independent audit passes, including reclassifying 4 of its own team's overstated severity claims) and 100+ passing tests — is nowhere in the current pitch. This is a wasted asset: security- and quality-conscious HN/r/programming readers respond well to demonstrated self-critical rigor and respond badly to unqualified superlatives ("beautiful," "production-ready," "30 seconds").

### Recommended reframing

Replace speed/magic framing with rigor/verifiability framing. Concrete alternatives, in order of preference:

- **Primary tagline candidate:** *"A scaffolding CLI for AI agent loops — verification gates, budget caps, and convergence criteria, generated for you. Audited: 15 bugs found and fixed across 3 independent review passes before v1.0."*
- **Alternative, shorter:** *"Stop copy-pasting agent loop config between projects. `kit init` generates the verification gate, budget cap, and state tracking your last five loops were missing."*
- **For Show HN title specifically** (these have their own norms — factual, low-hype, first-person is fine): *"Show HN: Kit – CLI that scaffolds agent-loop guardrails (budget caps, verification gates) for Claude Code, Codex, Gemini"*. Avoid adjectives ("beautiful," "production-ready") in the title entirely; let the tool's actual terminal output (which genuinely is polished, via Clack) demonstrate that itself in the linked GIF/demo.

### Specific things to cut from any launch copy

- "30 seconds" — replace with a concrete, honest number if timed, or drop entirely.
- "Production-ready" — replace with "opinionated defaults" or "a working starting point," and only reintroduce once Gate A/B in §1 close.
- Bare feature-count claims ("5 questions, six files") are fine — they're factual and unglamorous, which reads as credible in these communities.
- Any comparison table that names competitors by star count (as in the README's "Competitive Landscape" table) should **not** be part of the launch post itself — bringing up spec-kit's 111K stars and claude-code-templates' 28.4K stars in your own launch thread invites "why would I use the 6-template tool over the 600-template one" as the top comment. Save comparative positioning for the README (where an interested reader opts in), not the launch pitch (where you're choosing the frame for someone who hasn't decided to care yet).
- Drop "battle-tested templates" (6 built-in templates that have not, in fact, been run against real-world codebases at any scale is not "battle-tested" — it's "curated" or "starter").

### Anticipated pushback and pre-emptive responses

Recent community sentiment around AI-agent-adjacent tool launches skews toward: (a) "another wrapper around a wrapper," (b) demands to see it fail gracefully / handle edge cases, (c) skepticism of any tool that generates config *for* an AI agent as itself possibly AI-generated slop. Mitigate by:
- Leading with the FINDINGS.md-style rigor angle (see above).
- Being upfront in the post body that this is v0.x, explicitly listing known limitations (e.g., LTF trace-writing not yet wired end-to-end, if still true at launch time) rather than waiting for someone to find and announce the gap.
- Having a maintainer (not a bot/auto-reply) genuinely respond to the first 10-20 comments within the first hour — response quality/authenticity matters more on these platforms than post polish.

---

## 3. Template contribution guide gaps

Read directly (not from the other agent's draft): `src/types.ts` (`Template` interface), `src/templates/registry.ts` (`loadBuiltinTemplates` validation), `src/templates/__tests__/registry.test.ts`, all 6 files in `templates/*.yaml`, and `src/generators/index.ts` (how `agent_instructions` is consumed).

### What registry.ts actually enforces (and what it silently doesn't)

`loadBuiltinTemplates()` (`src/templates/registry.ts:31-68`) requires, on pain of the *entire template being silently dropped* (not an error — a `catch { /* skip malformed templates */ }`):

```
typeof parsed?.name === "string"
typeof parsed?.description === "string"
typeof parsed?.goal === "string"
typeof parsed?.verification?.command === "string"
typeof parsed?.budget?.suggested_usd === "number"
typeof parsed?.budget?.suggested_iterations === "number"
```

`tags` and `agent_instructions` are **not required** — if absent or malformed, they're silently defaulted (`tags = []`, `agent_instructions = {}`). This is friendlier than it looks, but also means a contributor gets **no feedback at all** if they typo a field name: the template just vanishes from `kit templates` output with no error, no CI failure at the registry-load layer, and no obvious symptom to debug from ("why isn't my template showing up?").

### Non-obvious requirements a contribution guide MUST call out explicitly

These are gaps a first-time contributor reading only `templates/fix-types.yaml` as a reference would plausibly get wrong, and which are enforced *not* by `registry.ts` but by a separate, easy-to-miss test file:

1. **`registry.test.ts` re-validates every template in the directory, including newly contributed ones, with stricter rules than `registry.ts` itself.** `src/templates/__tests__/registry.test.ts:14-24` iterates `listTemplates()` (which includes anything dropped into `templates/`) and asserts `t.budget.suggested_usd` and `t.budget.suggested_iterations` are `> 0`, not just `typeof === "number"`. A contributor could write `suggested_usd: 0` (meaning "no suggestion" / free) — this loads fine per `registry.ts`, but **fails CI** via this test, which is not referenced anywhere in the template format docs. **The contribution guide must state the `> 0` constraint explicitly**, because nothing else visible to a contributor states it.
2. **`agent_instructions` keys must exactly match the `AgentType` union values, using hyphens, not underscores — and this is not validated anywhere, it just silently no-ops.** `src/types.ts:18` defines `AgentType = "claude-code" | "codex" | "gemini" | "cursor"`, and `src/generators/index.ts:81` looks up `template?.agent_instructions?.[answers.agent]`. All 6 shipped templates correctly key their Claude Code block as `claude-code:` (hyphenated) — **but the original pitch document itself (`ideas/04-kit.md` line 171, "Template Format" example) uses `claude_code:` (underscore)**. A contributor who copies that example from the idea doc instead of an actual shipped `templates/*.yaml` file will produce a template that loads successfully, passes both validation layers, passes CI — and simply never surfaces its Claude Code instructions to any user, silently falling back to generic content. There is no test anywhere (`generators.test.ts` has zero references to `agent_instructions` or `templateInstructions`) that would catch this — it is a pure silent-data-loss bug from the contributor's perspective, discoverable only by manually running `kit init --template <name>` and reading the generated `CLAUDE.md` closely. **This must be called out by name in the contribution guide**, ideally with a copy-pasteable "use exactly these four keys: `claude-code`, `codex`, `gemini`, `cursor`" line.
3. **No template in the codebase has ever populated a `cursor` key**, despite `cursor` being a fully supported `AgentType` that reuses the Claude Code generator path (`src/generators/index.ts:99-103`, `generateAgentConfig`'s `case "cursor"` calls `generateClaudeMd` with `template?.agent_instructions?.["cursor"]`). This means every Cursor user of every existing template gets generic instructions with no template-specific guidance — the built-in templates are themselves inconsistent with what a thorough contribution would look like. A contribution guide that tells new contributors to include `cursor` instructions, while the 6 shipped examples they're copying from don't, will produce confusion ("why don't the official templates do this?"). **Recommend fixing the 6 built-in templates to add a `cursor` key (or explicitly documenting that `cursor` intentionally falls back to `claude-code` content and contributors should skip it) before publishing a contribution guide that asks contributors to do more rigor than the maintainer's own examples show.**
4. **No uniqueness check on `name`.** `findTemplate()` (`src/templates/registry.ts:70-72`) does `.find((t) => t.name === name)`, returning the first match in `readdirSync` order (filesystem/alphabetical, not guaranteed stable across OSes). Two contributed templates with a colliding `name:` field will not error anywhere — one simply becomes permanently unreachable via `kit init --template <name>` and `kit templates --search`, silently. A contribution guide should tell contributors to name their YAML file identically to the `name:` field and to check `kit templates` output before submitting, since nothing else will catch a collision.
5. **`verification.description` is used nowhere in the generator code** (only `verification.command` is consumed by `src/generators/index.ts`) despite every shipped template populating it and the pitch doc implying it's part of the "format." It's harmless to omit, but a contribution guide describing the YAML schema should mark it explicitly as "optional / documentation-only, not currently rendered anywhere" so contributors don't over-invest in wording it carefully, and so nobody is confused when it doesn't show up in generated output.

### Summary table for the guide

| Field | Enforced by | Failure mode if wrong | Must document? |
|---|---|---|---|
| `name`, `description`, `goal` (strings) | `registry.ts` | Whole template silently dropped, no error | Yes (basic) |
| `verification.command` (string) | `registry.ts` | Whole template silently dropped | Yes (basic) |
| `budget.suggested_usd`, `suggested_iterations` (number, **>0**) | `registry.ts` (type only) **+ `registry.test.ts`** (>0) | Loads, then **fails CI** on the `>0` assertion — surprising since it's in a test file, not the schema | **Yes — explicitly, this is the #1 gotcha** |
| `agent_instructions` keys (`claude-code`/`codex`/`gemini`/`cursor`, hyphenated) | Nothing — silent lookup miss | Loads, passes CI, **silently drops that agent's custom instructions forever** | **Yes — explicitly, this is the #2 gotcha, and the idea-doc's own example gets it wrong** |
| `name` uniqueness across files | Nothing | Loads, passes CI, one template becomes unreachable | Yes |
| `verification.description` | Nothing (unused) | No effect either way | Yes (mark as cosmetic/optional) |

---

## 4. Remote registry counter-argument

### Steelman: build a remote fetch mechanism now

Without any remote mechanism, "community templates" requires: fork `loop-eng/kit` → clone locally → add a YAML file to `templates/` → open a PR → wait for a solo maintainer's review → get merged → wait for the *next npm release* to actually ship the new template to users. That is five to seven steps and at least one maintainer-review round-trip and one release cycle, compared to the far lower-friction pattern users already expect from adjacent tools: `claude-code-templates` and similar catalogs let users pull a specific asset without needing write access to any canonical repo. A contributor with a genuinely useful template for their own team's workflow (e.g., "our internal migration pattern") has essentially no reason to go through a PR-and-release cycle just to use it themselves, let alone share it — they'll just keep it in their own dotfiles. **The absence of a zero-maintainer-in-the-loop distribution path is a real structural reason "community templates" could simply never accumulate**, independent of how good the contribution guide is.

### Steelman: don't build it, PR-based is enough for v1.0

Zero remote infrastructure exists today (`grep` for `remote.ts`, `fetch`, or any URL-loading code in `src/templates/` returns nothing — the "remote template fetcher" module sketched in the original architecture diagram was never built). Building one for v1.0 means also owning, before any launch: template security review (arbitrary shell commands in `verification.command` fetched from a URL and run locally is a real supply-chain risk — this is a materially different threat model than "a PR a human reviewed"), a naming/namespace scheme, a caching/versioning story, and a way to keep a decentralized registry from rotting (dead URLs, abandoned templates). None of that is needed to prove the core wizard/generator value proposition, and building it before there is any evidence of contributor demand is speculative infrastructure investment for an audience of contributors that doesn't exist yet (v0.1.0, presumably 0-1 external contributors).

### Verdict

**PR-based contribution is sufficient to *ship* v1.0, but insufficient to make the "community template ecosystem" pillar of the pitch true, and the launch messaging should be adjusted accordingly rather than the engineering scope being expanded.** Concretely:

- Do not build a remote registry for v1.0 — the security review burden alone (arbitrary command execution from an unreviewed source) is disproportionate to unproven demand, and matches the original spec's own v1.1 deferral.
- Do not claim "community template ecosystem" as a *present-tense* v1.0 pillar in launch copy. It is currently a v1.1+ aspiration gated on a PR process that has never been exercised even once. Reframe the pitch's fifth pillar from "community template ecosystem" (implies it exists) to "designed for template contributions" or "open template format" (accurately describes the current state: a documented YAML schema and a PR path, nothing more).
- As a cheap middle ground that doesn't require a full registry: consider (post-v1.0, not blocking launch) a `kit init --template-file <path-or-url>` flag that loads one ad-hoc YAML file the same way built-in templates are validated (reusing the exact `registry.ts` validation function) — this gives individual users/teams a way to use and share a template via a raw GitHub URL or gist without needing repo write access or a registry service, at a fraction of the engineering cost of a full registry, and would make "community templates" true in a limited but honest sense. This is a good Phase 6 candidate, not a Phase 5/v1.0 blocker.
- If the parallel agent's plan recommends building a remote registry now, push back — the risk/effort is not justified pre-launch, before there's a single external contributor to serve.

---

## 5. Grounded success metrics

### Original targets (from `ideas/04-kit.md`, "Success Metrics")
- Month 1: 300+ npm weekly downloads, 200+ GitHub stars
- Month 3: community template contributions, 1,000+ stars

### Reality check against the plan's own competitive data

The plan's own Competitive Landscape table is useful evidence *against* its own targets: **dotforge sits at 301 stars total** (not per month — cumulative, over whatever its lifetime has been) for a comparable Claude-specific config tool, and **mex sits at 1.1K stars total** for a memory-scaffold tool. Neither of those cumulative totals was achieved in a single month, and both likely represent a longer accumulation period with presumably more marketing/network effects than a first-time solo launch has. Using either as a "month 1" or even "month 3" bar for kit is not supported by the table's own numbers — it's aspirational copy dressed as a plan.

Baseline reality for new CLI tools launched by a solo/small maintainer with no pre-existing following or newsletter/community reach, based on typical outcomes for Show HN / r/programming launches of developer tools in this category:
- A **successful** Show HN post (front page, several hours of visibility) typically converts to roughly 50-300 GitHub stars in the following week, and a much smaller fraction of visitors (typically low single-digit percent) actually install and run the tool, let alone continue using it weekly.
- A **typical/median** Show HN post (doesn't reach front page, gets some comments) converts to roughly 10-50 stars total.
- npm weekly download counts for a brand-new scoped package with no existing user base are dominated by CI/bot traffic and curiosity `npx` runs in the first weeks; sustained "weekly active" downloads in the hundreds require either continued content marketing (blog posts, follow-up threads) or the tool becoming an actual dependency in other projects/CI pipelines — neither of which exists yet for kit.

### Grounded counter-estimates

| Metric | Original target | Grounded estimate | Reasoning |
|---|---|---|---|
| GitHub stars, Month 1 | 200+ | **20-80** (60-150 in an optimistic front-page scenario) | Matches typical solo-maintainer Show HN outcomes; dotforge's 301 lifetime total makes 200 in 30 days an outlier scenario, not a baseline |
| npm weekly downloads, Month 1 | 300+ | **10-50**, with high variance and likely bot/CI noise inflating the raw number | No existing distribution channel; "weekly downloads" for a tool with no recurring-use case yet (you run `kit init` once per project, not weekly) is a metric mismatch — see note below |
| GitHub stars, Month 3 | 1,000+ | **80-350** without a second viral moment; 1,000 requires either a second successful launch cycle, a notable adopter/backlink, or sustained content marketing | 1,000 stars by month 3 for a tool with zero pre-existing audience is a top-decile outcome, not a plan-grade estimate |
| Community template contributions, Month 3 | (implied: some) | **Realistically 0-2 external PRs** unless actively solicited (e.g., maintainer opens "good first issue"-labeled template requests) | See §4 — PR-based-only path is high friction; absent deliberate outreach, organic contribution is unlikely this early |

**Metric-design flag, independent of the numbers:** "weekly npm downloads" is a poor north-star metric for a tool used once-per-project-setup rather than repeatedly. A more meaningful metric would be **unique installs/first-runs per month** (not obtainable from npm download counts alone, which conflate one-time `npx` runs, CI reinstalls, and mirrors) or **number of distinct repositories with a `.loop/` directory** if that's ever instrumentable, or simply **GitHub stars + issues/PRs opened** as a proxy for genuine interest.

**Recommendation:** Treat the original numbers as motivational, internal-only targets, not as public commitments or launch-copy claims ("join 300+ developers using kit weekly" would be actively false in month 1 and should never appear in any launch asset). Set the actual OKR-style targets at the low end of the ranges above, and treat anything beyond that as a bonus rather than a baseline expectation to plan resourcing around.

---

## 6. Minimum viable CONTRIBUTING.md scope

Kit is a single-maintainer project at v0.1.0 with (per the evidence above) essentially zero external contributors to date. Investing in heavy contributor process now is solving a problem that doesn't exist yet, at the cost of maintenance burden that does exist (someone has to keep a CLA, governance doc, and multiple issue/PR templates up to date, and a project with elaborate process but no contributors reads as either overconfident or abandoned-process-theater to the first person who does show up).

### Recommend including (minimum viable)
- **How to run the project locally**: `npm install`, `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`, `bash demo/test_e2e.sh` (all already documented in the README's "Development" section — CONTRIBUTING.md can largely point there rather than duplicate it).
- **How to add a template**: the concrete schema plus the exact non-obvious gotchas from §3 above (the `>0` budget constraint enforced by a test file, the exact `agent_instructions` key spelling, the `name` uniqueness expectation). This is the single highest-value section, since template PRs are the most likely near-term contribution type and are exactly where a first-timer will silently get it wrong.
- **What CI checks on a PR**: one paragraph — typecheck, lint, build, `vitest run` (which includes template validation for anything dropped into `templates/`) — so a contributor isn't surprised by a failing check they didn't know existed.
- **A one-line expectations statement**: "This is a young, single-maintainer project — response times may be a few days; small, focused PRs are much easier to review than large ones."
- **License reminder**: one line noting contributions are under the existing MIT license (no separate CLA needed at this scale — a CLA is disproportionate process for a project with no contributors yet, and can be introduced later if a corporate contributor ever requires it).

### Recommend explicitly deferring (do not build yet)
- Formal governance doc / maintainer ladder / code of conduct beyond a short one-liner or standard link (Contributor Covenant link is fine if desired, but a bespoke doc is not needed).
- CLA / DCO tooling.
- Issue and PR templates beyond perhaps one lightweight PR checklist embedded in CONTRIBUTING.md itself (a separate `.github/ISSUE_TEMPLATE/` set of forms is process overhead disproportionate to current traffic).
- A "good first issue" curation program or contributor-recognition system.
- Any tooling for a remote template registry (see §4).

**Trigger for revisiting scope:** once the project has received on the order of 5-10 external PRs, or once a single template PR gets something wrong that a slightly heavier process (e.g., a PR template with a checklist) would have caught, revisit and add process incrementally at that point — not preemptively.

---

## 7. Open questions requiring a human decision

1. **Is LTF trace-writing actually going to be finished before any public launch, and on what timeline?** This review treats it as a hard gate (§1). If the human decision is "ship without it and just be honest in the copy," that's a legitimate alternative — but it must be an explicit, conscious choice about the pitch's honesty, not a gap that launch copy quietly papers over.
2. **Is there appetite/bandwidth to add even minimal wizard-path test coverage before launch**, given it currently has none? If not, is the team willing to accept the risk of a live, public wizard crash during a traffic spike, and does the launch plan include a fast-response commitment (e.g., someone actively monitoring for the first few hours post-launch) as a mitigation instead?
3. **Should the built-in templates be fixed to add `cursor` agent_instructions (or explicitly document the fallback) before a contribution guide asks new contributors to do more rigor than the shipped examples demonstrate?** This is a small fix but affects whether the contribution guide is internally consistent with its own examples.
4. **What is the actual internal target for "success" if the public numbers in §5 are abandoned as commitments?** Someone needs to own a real (lower, private) number so that a "disappointing" launch doesn't get misjudged against the original 200-stars/300-downloads figures, or conversely so a genuinely good outcome (e.g., 60 stars, no viral moment) isn't dismissed as a failure against an unrealistic bar.
5. **Does the org want to commit, even informally, to the `--template-file <url>` middle-ground feature proposed in §4** as a Phase 6 item, to keep "community templates" credibly on a roadmap rather than indefinitely deferred? This doesn't need to be decided now, but should be flagged so it doesn't get lost.
6. **Who is the "someone" responding to Show HN/r/programming comments in the first hour** (§2)? If the team is truly solo, is there a realistic plan for same-day responsiveness, or should the launch be timed for a day/window where the maintainer has several free hours on standby?
