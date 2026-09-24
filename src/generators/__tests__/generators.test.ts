import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateAll } from "../index.js";
import type { WizardAnswers, DetectionResult } from "../../types.js";
import type { VerificationInfo } from "../../detectors/verification.js";

describe("generateAll", () => {
  let dir: string;

  const defaults: WizardAnswers = {
    task: "Fix all TypeScript errors",
    verification: "test-suite",
    budget: "standard",
    agents: ["claude-code"],
    iterations: 10,
  };

  const detection: DetectionResult = {
    stack: "typescript",
    testRunner: "vitest",
    agents: ["claude-code"],
    verificationCommand: "npx vitest run",
  };

  const verification: VerificationInfo = {
    testCommand: "npx vitest run",
    buildCommand: "npx tsc --noEmit",
    lintCommand: "npx eslint .",
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kit-gen-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("generates CLAUDE.md for claude-code agent", async () => {
    const files = await generateAll({
      dir,
      answers: defaults,
      detection,
      verification,
      budgetUsd: 20,
      budgetMinutes: 60,
    });

    expect(files).toContain("CLAUDE.md");
    const content = readFileSync(join(dir, "CLAUDE.md"), "utf-8");
    expect(content).toContain("Fix all TypeScript errors");
    expect(content).toContain("npx vitest run");
  });

  it("generates AGENTS.md for codex agent", async () => {
    const files = await generateAll({
      dir,
      answers: { ...defaults, agents: ["codex"] },
      detection,
      verification,
      budgetUsd: 20,
      budgetMinutes: 60,
    });

    expect(files).toContain("AGENTS.md");
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(true);
  });

  it("generates GEMINI.md for gemini agent", async () => {
    const files = await generateAll({
      dir,
      answers: { ...defaults, agents: ["gemini"] },
      detection,
      verification,
      budgetUsd: 20,
      budgetMinutes: 60,
    });

    expect(files).toContain("GEMINI.md");
  });

  it("generates all required loop files", async () => {
    const files = await generateAll({
      dir,
      answers: defaults,
      detection,
      verification,
      budgetUsd: 20,
      budgetMinutes: 60,
    });

    expect(files).toContain(".loop/verify.sh");
    expect(files).toContain(".claude/hooks/verify.sh");
    expect(files).toContain(".loop/goal.md");
    expect(files).toContain(".loop/budget.yaml");
    expect(files).toContain(".loop/ltf.config.yaml");
    expect(files).toContain(".loop/state.md");
  });

  it("generates valid budget yaml", async () => {
    await generateAll({
      dir,
      answers: defaults,
      detection,
      verification,
      budgetUsd: 20,
      budgetMinutes: 60,
    });

    const content = readFileSync(join(dir, ".loop/budget.yaml"), "utf-8");
    expect(content).toContain("max_cost_usd: 20");
    expect(content).toContain("max_iterations: 10");
    expect(content).toContain("npx vitest run");
  });

  it("generates hook script with verify command", async () => {
    await generateAll({
      dir,
      answers: defaults,
      detection,
      verification,
      budgetUsd: 20,
      budgetMinutes: 60,
    });

    const content = readFileSync(
      join(dir, ".loop/verify.sh"),
      "utf-8",
    );
    expect(content).toContain("#!/usr/bin/env bash");
    expect(content).toContain("npx vitest run");
    expect(content).toContain("trace.ltf.jsonl");
    expect(content).toContain("loop_summary");
  });

  it("ltf.config.yaml is honest about the LTF schema (has phase/ltf_version/loop_id)", async () => {
    await generateAll({
      dir,
      answers: defaults,
      detection,
      verification,
      budgetUsd: 20,
      budgetMinutes: 60,
    });

    const content = readFileSync(join(dir, ".loop/ltf.config.yaml"), "utf-8");
    expect(content).toContain("ltf_version");
    expect(content).toContain("loop_id");
    expect(content).toContain("phase");
    expect(content).toContain("not_captured");
  });

  it("budget.yaml and ltf.config.yaml agree on the trace output path", async () => {
    await generateAll({
      dir,
      answers: defaults,
      detection,
      verification,
      budgetUsd: 20,
      budgetMinutes: 60,
    });

    const budgetContent = readFileSync(join(dir, ".loop/budget.yaml"), "utf-8");
    const ltfContent = readFileSync(join(dir, ".loop/ltf.config.yaml"), "utf-8");
    expect(budgetContent).toContain(".loop/trace.ltf.jsonl");
    expect(ltfContent).toContain(".loop/trace.ltf.jsonl");
  });

  it("generates configs for multiple agents in one run", async () => {
    const files = await generateAll({
      dir,
      answers: { ...defaults, agents: ["claude-code", "codex", "gemini", "cursor"] },
      detection,
      verification,
      budgetUsd: 20,
      budgetMinutes: 60,
    });

    expect(files).toContain("CLAUDE.md");
    expect(files).toContain("AGENTS.md");
    expect(files).toContain("GEMINI.md");
    expect(files).toContain(".cursorrules");
  });

  it("only writes .claude/hooks/verify.sh once for multi-agent runs including claude-code", async () => {
    const files = await generateAll({
      dir,
      answers: { ...defaults, agents: ["claude-code", "codex", "gemini"] },
      detection,
      verification,
      budgetUsd: 20,
      budgetMinutes: 60,
    });

    const hookCopies = files.filter((f) => f.endsWith("verify.sh"));
    expect(hookCopies).toEqual([".loop/verify.sh", ".claude/hooks/verify.sh"]);
  });

  it("does not write .claude/hooks/verify.sh when neither claude-code nor cursor is selected", async () => {
    const files = await generateAll({
      dir,
      answers: { ...defaults, agents: ["codex", "gemini"] },
      detection,
      verification,
      budgetUsd: 20,
      budgetMinutes: 60,
    });

    expect(files).not.toContain(".claude/hooks/verify.sh");
    expect(files).toContain(".loop/verify.sh");
  });

  it("writes a kit.json manifest recording the selected agents", async () => {
    await generateAll({
      dir,
      answers: { ...defaults, agents: ["claude-code", "gemini"] },
      detection,
      verification,
      budgetUsd: 20,
      budgetMinutes: 60,
    });

    const manifest = JSON.parse(readFileSync(join(dir, ".loop/kit.json"), "utf-8"));
    expect(manifest.agents).toEqual(["claude-code", "gemini"]);
  });

  it("falls back cursor's template instructions to claude-code's when no cursor key exists", async () => {
    const templateWithNoCursorKey = {
      name: "test-template",
      description: "test",
      tags: [],
      goal: "test goal",
      verification: { command: "npm test", description: "test" },
      budget: { suggested_usd: 10, suggested_iterations: 10 },
      agent_instructions: { "claude-code": "## Custom Claude Instructions\nDo the thing." },
    };

    await generateAll({
      dir,
      answers: { ...defaults, agents: ["cursor"] },
      detection,
      verification,
      budgetUsd: 20,
      budgetMinutes: 60,
      template: templateWithNoCursorKey,
    });

    const content = readFileSync(join(dir, ".cursorrules"), "utf-8");
    expect(content).toContain("Custom Claude Instructions");
  });

  it("gitignore includes the LTF tracer state file", async () => {
    await generateAll({
      dir,
      answers: defaults,
      detection,
      verification,
      budgetUsd: 20,
      budgetMinutes: 60,
    });

    const gitignore = readFileSync(join(dir, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".loop/.ltf-state.json");
    expect(gitignore).toContain(".loop/trace.ltf.jsonl");
  });

  it("uses build command when verification is build-passes", async () => {
    const files = await generateAll({
      dir,
      answers: { ...defaults, verification: "build-passes" },
      detection,
      verification,
      budgetUsd: 20,
      budgetMinutes: 60,
    });

    expect(files).toContain("CLAUDE.md");
    const content = readFileSync(join(dir, "CLAUDE.md"), "utf-8");
    expect(content).toContain("npx tsc --noEmit");
  });

  it("generates unlimited budget with null values", async () => {
    await generateAll({
      dir,
      answers: { ...defaults, budget: "unlimited", iterations: 0 },
      detection,
      verification,
      budgetUsd: 0,
      budgetMinutes: 0,
    });

    const content = readFileSync(join(dir, ".loop/budget.yaml"), "utf-8");
    expect(content).toContain("max_cost_usd: null");
    expect(content).toContain("max_iterations: null");
  });
});
