import { Command } from "commander";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { resolve } from "node:path";
import { existsSync, statSync } from "node:fs";
import { detectAll, detectVerification } from "../detectors/index.js";
import type {
  AgentType,
  BudgetTier,
  VerificationMethod,
  WizardAnswers,
} from "../types.js";
import { generateAll } from "../generators/index.js";
import { findTemplate } from "../templates/registry.js";

interface InitOptions {
  template?: string;
  yes?: boolean;
  dir: string;
}

const BUDGET_MAP: Record<BudgetTier, { usd: number; minutes: number }> = {
  quick: { usd: 5, minutes: 15 },
  standard: { usd: 20, minutes: 60 },
  thorough: { usd: 50, minutes: 120 },
  unlimited: { usd: 0, minutes: 0 },
};

const ITERATION_MAP: Record<string, number> = {
  conservative: 5,
  standard: 10,
  thorough: 25,
  unlimited: 0,
};

export const initCommand = new Command("init")
  .description("Scaffold a production-ready agent loop")
  .option("-t, --template <name>", "use a specific template")
  .option("-y, --yes", "accept all defaults (non-interactive)")
  .option("-d, --dir <path>", "target directory", ".")
  .action(async (opts: InitOptions) => {
    const dir = resolve(opts.dir);

    if (existsSync(dir) && !statSync(dir).isDirectory()) {
      p.cancel(`"${opts.dir}" is not a directory.`);
      process.exit(1);
    }

    const detection = detectAll(dir);
    const verification = detectVerification(
      dir,
      detection.stack,
      detection.testRunner,
    );

    if (opts.template) {
      const tmpl = findTemplate(opts.template);
      if (!tmpl) {
        p.cancel(`Template "${opts.template}" not found. Run \`kit templates\` to see available templates.`);
        process.exit(1);
      }
      const answers: WizardAnswers = {
        task: tmpl.goal.trim(),
        verification: "custom",
        budget: budgetTierFromUsd(tmpl.budget.suggested_usd),
        agent: detection.agents.length > 0 ? detection.agents[0] : "claude-code",
        iterations: tmpl.budget.suggested_iterations,
      };
      await runGeneration(dir, answers, detection, verification, tmpl);
      return;
    }

    if (opts.yes) {
      const answers = buildDefaults(detection, verification.testCommand);
      await runGeneration(dir, answers, detection, verification);
      return;
    }

    p.intro(pc.bgCyan(pc.black(" @loop-eng/kit ")));

    const detectedInfo: string[] = [];
    if (detection.stack !== "unknown")
      detectedInfo.push(`stack: ${pc.cyan(detection.stack)}`);
    if (detection.testRunner !== "unknown")
      detectedInfo.push(`tests: ${pc.cyan(detection.testRunner)}`);
    if (detection.agents.length > 0)
      detectedInfo.push(
        `agents: ${pc.cyan(detection.agents.join(", "))}`,
      );

    if (detectedInfo.length > 0) {
      p.note(detectedInfo.join("\n"), "Detected");
    }

    const answers = await runWizard(detection, verification.testCommand);
    if (!answers) {
      p.cancel("Setup cancelled.");
      process.exit(130);
    }

    await runGeneration(dir, answers, detection, verification);
  });

async function runWizard(
  detection: ReturnType<typeof detectAll>,
  defaultVerifyCmd: string,
): Promise<WizardAnswers | null> {
  const task = await p.text({
    message: "What's the task?",
    placeholder: "e.g., Fix all TypeScript errors in src/",
    validate: (v) => {
      if (!v.trim()) return "Task is required";
    },
  });

  if (p.isCancel(task)) return null;

  const verificationChoice = (await p.select({
    message: "How do you verify success?",
    options: [
      {
        value: "test-suite" as const,
        label: "Test suite",
        hint: defaultVerifyCmd,
      },
      {
        value: "build-passes" as const,
        label: "Build passes",
        hint: detection.stack === "typescript" ? "tsc --noEmit" : undefined,
      },
      { value: "lint-clean" as const, label: "Lint clean" },
      { value: "custom" as const, label: "Custom command" },
    ],
  })) as VerificationMethod | symbol;

  if (p.isCancel(verificationChoice)) return null;

  let customCommand: string | undefined;
  if (verificationChoice === "custom") {
    const cmd = await p.text({
      message: "What command verifies success?",
      placeholder: "e.g., npm test && npm run lint",
      validate: (v) => {
        if (!v.trim()) return "Command is required";
      },
    });
    if (p.isCancel(cmd)) return null;
    customCommand = cmd as string;
  }

  const budgetChoice = (await p.select({
    message: "Budget cap?",
    options: [
      { value: "quick" as const, label: "$5 (quick fix)" },
      { value: "standard" as const, label: "$20 (feature work)" },
      { value: "thorough" as const, label: "$50 (complex task)" },
      { value: "unlimited" as const, label: "Unlimited" },
    ],
  })) as BudgetTier | symbol;

  if (p.isCancel(budgetChoice)) return null;

  const defaultAgent =
    detection.agents.length > 0 ? detection.agents[0] : "claude-code";

  const agentChoice = (await p.select({
    message: "Which agent?",
    initialValue: defaultAgent,
    options: [
      { value: "claude-code" as const, label: "Claude Code" },
      { value: "codex" as const, label: "Codex CLI" },
      { value: "gemini" as const, label: "Gemini CLI" },
      { value: "cursor" as const, label: "Cursor" },
    ],
  })) as AgentType | symbol;

  if (p.isCancel(agentChoice)) return null;

  const iterationChoice = (await p.select({
    message: "Iteration limit?",
    options: [
      { value: "conservative", label: "5 (conservative)" },
      { value: "standard", label: "10 (standard)" },
      { value: "thorough", label: "25 (thorough)" },
      { value: "unlimited", label: "Unlimited" },
    ],
  })) as string | symbol;

  if (p.isCancel(iterationChoice)) return null;

  return {
    task: task as string,
    verification: verificationChoice as VerificationMethod,
    customCommand,
    budget: budgetChoice as BudgetTier,
    agent: agentChoice as AgentType,
    iterations: ITERATION_MAP[iterationChoice as string] ?? 10,
  };
}

function buildDefaults(
  detection: ReturnType<typeof detectAll>,
  _verifyCmd: string,
): WizardAnswers {
  return {
    task: "Fix issues in the project",
    verification: "test-suite",
    budget: "standard",
    agent:
      detection.agents.length > 0 ? detection.agents[0] : "claude-code",
    iterations: 10,
  };
}

function budgetTierFromUsd(usd: number): BudgetTier {
  if (usd <= 5) return "quick";
  if (usd <= 20) return "standard";
  if (usd <= 50) return "thorough";
  return "unlimited";
}

async function runGeneration(
  dir: string,
  answers: WizardAnswers,
  detection: ReturnType<typeof detectAll>,
  verification: import("../detectors/verification.js").VerificationInfo,
  template?: import("../types.js").Template,
): Promise<void> {
  if (template?.verification?.command) {
    verification = { ...verification, testCommand: template.verification.command };
  }

  const budget = BUDGET_MAP[answers.budget];

  const s = p.spinner();
  s.start("Generating loop configuration...");

  let files: string[];
  try {
    files = await generateAll({
      dir,
      answers: template
        ? { ...answers, verification: "test-suite" }
        : answers,
      detection,
      verification,
      budgetUsd: budget.usd,
      budgetMinutes: budget.minutes,
      template,
    });
    s.stop("Generated loop configuration");
  } catch (err) {
    s.stop("Generation failed");
    p.cancel(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  p.note(
    files.map((f) => `${pc.green("✓")} ${f}`).join("\n"),
    "Files created",
  );

  const startHint = getStartHint(answers.agent);
  p.outro(`Run ${pc.cyan(startHint)} to start your loop`);
}

function getStartHint(agent: AgentType): string {
  switch (agent) {
    case "claude-code":
      return "claude";
    case "codex":
      return "codex";
    case "gemini":
      return "gemini";
    case "cursor":
      return "cursor";
  }
}
