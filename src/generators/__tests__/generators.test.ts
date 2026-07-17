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
    agent: "claude-code",
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
      answers: { ...defaults, agent: "codex" },
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
      answers: { ...defaults, agent: "gemini" },
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
