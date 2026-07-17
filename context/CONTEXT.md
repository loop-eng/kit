# LoopKit — Loop Scaffolding CLI: Development Context

## Project Summary
LoopKit is an interactive CLI that scaffolds production-ready agent loops in 30 seconds — generates CLAUDE.md sections, hooks, goal definitions, verification gates, budget configs, and state files.

## Origin
- Loop setup takes 30-60 minutes per project (reading docs, writing hooks, configuring settings)
- No tool combines interview UX + ready-to-run output + curated templates
- Templates are community-expandable (npm/awesome-list growth pattern)

## Key Design Decisions (Pending)
- [ ] Interactive wizard UX (inquirer.js vs prompts vs clack)
- [ ] Template format and structure
- [ ] Cross-platform output (Claude Code configs vs Codex configs)
- [ ] Template contribution workflow
- [ ] npm package scope (@loopeng/kit vs @loop-eng/kit)

## Technical Stack
- Language: TypeScript (Node.js CLI)
- CLI Framework: clack or inquirer
- Distribution: npm (npx @loop-eng/kit)

## Research Status
- Research agent launched covering CLI scaffolding patterns, Claude Code config format, competitive analysis
