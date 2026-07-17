import { chmodSync } from "node:fs";
import { join } from "node:path";
import type { WizardAnswers, DetectionResult, Template } from "../types.js";
import type { VerificationInfo } from "../detectors/verification.js";
import { generateClaudeMd } from "./claude-md.js";
import { generateCodexMd } from "./codex-md.js";
import { generateGeminiMd } from "./gemini-md.js";
import { generateHooks } from "./hooks.js";
import { generateGoal } from "./goal.js";
import { generateBudget } from "./budget.js";
import { generateLtfConfig } from "./ltf-config.js";
import { ensureGitignore } from "../utils/git.js";
import { writeFileSafe, fileExists } from "../utils/fs.js";

export interface GenerateOptions {
  dir: string;
  answers: WizardAnswers;
  detection: DetectionResult;
  verification: VerificationInfo;
  budgetUsd: number;
  budgetMinutes: number;
  template?: Template;
}

export async function generateAll(opts: GenerateOptions): Promise<string[]> {
  const files: string[] = [];
  const { dir, answers } = opts;

  const verifyCommand = resolveVerifyCommand(opts);

  const agentFile = generateAgentConfig(opts, verifyCommand);
  writeFileSafe(join(dir, agentFile.path), agentFile.content);
  files.push(agentFile.path);
  const hookContent = generateHooks(verifyCommand);

  const loopHookPath = ".loop/verify.sh";
  writeFileSafe(join(dir, loopHookPath), hookContent);
  chmodSync(join(dir, loopHookPath), 0o755);
  files.push(loopHookPath);

  if (answers.agent === "claude-code" || answers.agent === "cursor") {
    const claudeHookPath = ".claude/hooks/verify.sh";
    writeFileSafe(join(dir, claudeHookPath), hookContent);
    chmodSync(join(dir, claudeHookPath), 0o755);
    files.push(claudeHookPath);
  }

  const goalPath = ".loop/goal.md";
  const goalContent = generateGoal(answers.task, verifyCommand);
  writeFileSafe(join(dir, goalPath), goalContent);
  files.push(goalPath);

  const budgetPath = ".loop/budget.yaml";
  const budgetContent = generateBudget({
    maxCostUsd: opts.budgetUsd,
    maxIterations: answers.iterations,
    maxDurationMinutes: opts.budgetMinutes,
    verifyCommand,
  });
  writeFileSafe(join(dir, budgetPath), budgetContent);
  files.push(budgetPath);

  const ltfPath = ".loop/ltf.config.yaml";
  const ltfContent = generateLtfConfig();
  writeFileSafe(join(dir, ltfPath), ltfContent);
  files.push(ltfPath);

  if (!fileExists(join(dir, ".loop/state.md"))) {
    writeFileSafe(join(dir, ".loop/state.md"), generateStateMd());
    files.push(".loop/state.md");
  }

  ensureGitignore(dir, [".loop/state.md", ".loop/trace.ltf.jsonl"]);

  return files;
}

function generateAgentConfig(opts: GenerateOptions, verifyCmd: string): { path: string; content: string } {
  const { answers, detection, verification, template } = opts;

  const templateInstructions = template?.agent_instructions?.[answers.agent] ?? null;

  switch (answers.agent) {
    case "claude-code":
      return {
        path: "CLAUDE.md",
        content: generateClaudeMd(answers.task, verifyCmd, detection, verification, templateInstructions),
      };
    case "codex":
      return {
        path: "AGENTS.md",
        content: generateCodexMd(answers.task, verifyCmd, templateInstructions),
      };
    case "gemini":
      return {
        path: "GEMINI.md",
        content: generateGeminiMd(answers.task, verifyCmd, templateInstructions),
      };
    case "cursor":
      return {
        path: ".cursorrules",
        content: generateClaudeMd(answers.task, verifyCmd, detection, verification, templateInstructions),
      };
  }
}

function resolveVerifyCommand(opts: GenerateOptions): string {
  const { answers, verification } = opts;

  switch (answers.verification) {
    case "test-suite":
      return verification.testCommand;
    case "build-passes":
      return verification.buildCommand ?? "echo 'No build command detected' && exit 1";
    case "lint-clean":
      return verification.lintCommand ?? "echo 'No lint command detected' && exit 1";
    case "custom":
      return answers.customCommand ?? "echo 'No custom command configured' && exit 1";
  }
}

function generateStateMd(): string {
  return `# Loop State

## Current Iteration
0

## Status
not_started

## Progress
- [ ] Loop not started yet
`;
}
