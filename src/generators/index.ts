import { chmodSync } from "node:fs";
import { join } from "node:path";
import type { WizardAnswers, DetectionResult, Template, AgentType } from "../types.js";
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
import { LTF_TRACE_PATH, LTF_TRACER_STATE_PATH } from "../utils/ltf-paths.js";

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

  const agentFiles = generateAgentConfigs(opts, verifyCommand);
  for (const agentFile of agentFiles) {
    writeFileSafe(join(dir, agentFile.path), agentFile.content);
    files.push(agentFile.path);
  }

  const hookContent = generateHooks(verifyCommand);

  const loopHookPath = ".loop/verify.sh";
  writeFileSafe(join(dir, loopHookPath), hookContent);
  chmodSync(join(dir, loopHookPath), 0o755);
  files.push(loopHookPath);

  // .claude/hooks/verify.sh is a convention-only file (not registered with
  // Claude Code's own hook system via .claude/settings.json) — kept for
  // claude-code/cursor users who look there by convention, but never
  // extended to Codex/Gemini, which have their own distinct, incompatible
  // native hook mechanisms. Writing a bash script at a path they don't
  // read would be misleading, not just redundant.
  if (answers.agents.includes("claude-code") || answers.agents.includes("cursor")) {
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

  // Records which agents were selected at scaffold time — `kit score`
  // uses this to grade multi-agent parity, and it's ordinary project
  // configuration (like budget.yaml), not transient runtime state, so
  // it's intentionally tracked in git, not gitignored.
  const manifestPath = ".loop/kit.json";
  writeFileSafe(join(dir, manifestPath), JSON.stringify({ agents: answers.agents }, null, 2) + "\n");
  files.push(manifestPath);

  if (!fileExists(join(dir, ".loop/state.md"))) {
    writeFileSafe(join(dir, ".loop/state.md"), generateStateMd());
    files.push(".loop/state.md");
  }

  ensureGitignore(dir, [".loop/state.md", LTF_TRACE_PATH, LTF_TRACER_STATE_PATH]);

  return files;
}

function agentConfigPath(agent: AgentType): string {
  switch (agent) {
    case "claude-code":
      return "CLAUDE.md";
    case "codex":
      return "AGENTS.md";
    case "gemini":
      return "GEMINI.md";
    case "cursor":
      return ".cursorrules";
  }
}

function agentInstructionsFor(template: Template | undefined, agent: AgentType): string | null {
  if (!template?.agent_instructions) return null;
  // No shipped template defines cursor-specific instructions today —
  // Cursor's .cursorrules format is close enough to CLAUDE.md's that
  // reusing claude-code's instructions is a reasonable default rather
  // than shipping an instructions-less file.
  if (agent === "cursor") {
    return template.agent_instructions.cursor ?? template.agent_instructions["claude-code"] ?? null;
  }
  return template.agent_instructions[agent] ?? null;
}

function generateAgentConfigs(
  opts: GenerateOptions,
  verifyCmd: string,
): Array<{ path: string; content: string }> {
  const { answers, detection, verification, template } = opts;

  return answers.agents.map((agent) => {
    const templateInstructions = agentInstructionsFor(template, agent);
    const path = agentConfigPath(agent);

    switch (agent) {
      case "claude-code":
      case "cursor":
        return {
          path,
          content: generateClaudeMd(answers.task, verifyCmd, detection, verification, templateInstructions),
        };
      case "codex":
        return {
          path,
          content: generateCodexMd(answers.task, verifyCmd, templateInstructions),
        };
      case "gemini":
        return {
          path,
          content: generateGeminiMd(answers.task, verifyCmd, templateInstructions),
        };
    }
  });
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
