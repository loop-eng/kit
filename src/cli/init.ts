import { Command } from "commander";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { resolve } from "node:path";
import { existsSync, statSync } from "node:fs";
import { detectAll, detectVerification } from "../detectors/index.js";
import { commandExists } from "../detectors/agent.js";
import type {
  AgentType,
  BudgetTier,
  VerificationMethod,
  WizardAnswers,
} from "../types.js";
import { generateAll } from "../generators/index.js";
import { findTemplate } from "../templates/registry.js";

const ALL_AGENTS: AgentType[] = ["claude-code", "codex", "gemini", "cursor"];

interface InitOptions {
  template?: string;
  yes?: boolean;
  dir: string;
  agent?: string;
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
  .option(
    "-a, --agent <agents>",
    "agent(s) to scaffold for: claude-code, codex, gemini, cursor, or all (comma-separate for multiple)",
  )
  .action(async (opts: InitOptions) => {
    const dir = resolve(opts.dir);

    if (existsSync(dir) && !statSync(dir).isDirectory()) {
      exitOnInvalidDir(opts.dir);
    }

    const detection = detectAll(dir);
    const verification = detectVerification(
      dir,
      detection.stack,
      detection.testRunner,
    );

    let agentOverride: AgentType[] | null = null;
    if (opts.agent) {
      agentOverride = parseAgentFlag(opts.agent);
      if (!agentOverride) {
        exitOnInvalidAgentFlag(opts.agent);
      }
    }

    if (opts.template) {
      const tmpl = findTemplate(opts.template);
      if (!tmpl) {
        exitOnTemplateNotFound(opts.template);
      }
      const answers: WizardAnswers = {
        task: tmpl.goal.trim(),
        verification: "custom",
        budget: budgetTierFromUsd(tmpl.budget.suggested_usd),
        agents: agentOverride ?? defaultAgents(detection),
        iterations: tmpl.budget.suggested_iterations,
      };
      await runGeneration(dir, answers, detection, verification, tmpl);
      return;
    }

    if (opts.yes) {
      const answers = buildDefaults(detection, agentOverride);
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

    const answers = await runWizard(detection, verification.testCommand, agentOverride);
    exitOnWizardCancel(answers);

    await runGeneration(dir, answers, detection, verification);
  });

// Extracted as standalone, exported functions (rather than left inline in
// the Command .action() callback) specifically so their exit codes are
// unit-testable by mocking process.exit — see FINDINGS.md #25, where
// process.exit(0) on cancel shipped once and the corresponding regression
// test only asserted runWizard()'s return value, never that the CLI
// actually exits non-zero.
export function exitOnInvalidDir(dirArg: string): never {
  p.cancel(`"${dirArg}" is not a directory.`);
  return process.exit(1);
}

export function exitOnInvalidAgentFlag(agentArg: string): never {
  p.cancel(
    `Invalid --agent value "${agentArg}". Use one or more of: claude-code, codex, gemini, cursor, or all.`,
  );
  return process.exit(1);
}

export function exitOnTemplateNotFound(templateArg: string): never {
  p.cancel(`Template "${templateArg}" not found. Run \`kit templates\` to see available templates.`);
  return process.exit(1);
}

export function exitOnWizardCancel(
  answers: WizardAnswers | null,
): asserts answers is WizardAnswers {
  if (!answers) {
    p.cancel("Setup cancelled.");
    process.exit(130);
  }
}

export function parseAgentFlag(value: string): AgentType[] | null {
  const parts = value
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);

  if (parts.length === 0) return null;
  if (parts.length === 1 && parts[0] === "all") return [...ALL_AGENTS];

  const requested = new Set<AgentType>();
  for (const part of parts) {
    if (!ALL_AGENTS.includes(part as AgentType)) return null;
    requested.add(part as AgentType);
  }
  // Canonical order regardless of how the user listed them, so generated
  // file order and .loop/kit.json are deterministic across invocations.
  return ALL_AGENTS.filter((agent) => requested.has(agent));
}

export function defaultAgents(detection: ReturnType<typeof detectAll>): AgentType[] {
  return detection.agents.length > 0 ? [detection.agents[0]] : ["claude-code"];
}

export async function runWizard(
  detection: ReturnType<typeof detectAll>,
  defaultVerifyCmd: string,
  agentOverride: AgentType[] | null,
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

  let agents: AgentType[];
  if (agentOverride) {
    agents = agentOverride;
  } else {
    const defaultAgent = defaultAgents(detection)[0];

    const agentChoice = (await p.select({
      message: "Which agent?",
      initialValue: defaultAgent,
      options: [
        { value: "claude-code" as const, label: "Claude Code" },
        { value: "codex" as const, label: "Codex CLI" },
        { value: "gemini" as const, label: "Gemini CLI" },
        { value: "all" as const, label: "All (multi-agent)" },
      ],
    })) as AgentType | "all" | symbol;

    if (p.isCancel(agentChoice)) return null;
    agents = agentChoice === "all" ? [...ALL_AGENTS] : [agentChoice];
  }

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
    agents,
    iterations: ITERATION_MAP[iterationChoice as string] ?? 10,
  };
}

export function buildDefaults(
  detection: ReturnType<typeof detectAll>,
  agentOverride: AgentType[] | null,
): WizardAnswers {
  return {
    task: "Fix issues in the project",
    verification: "test-suite",
    budget: "standard",
    agents: agentOverride ?? defaultAgents(detection),
    iterations: 10,
  };
}

export function budgetTierFromUsd(usd: number): BudgetTier {
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

  warnIfBashUnavailable();

  const startHint = getStartHint(answers.agents);
  p.outro(`Run ${pc.cyan(startHint)} to start your loop`);
}

// The generated verification gate (.loop/verify.sh) is a bash script — the
// only cross-agent integration point kit has today. On Windows without
// Git Bash or WSL, the generated hook can't run at all. This is a
// documented prerequisite, not something kit can paper over with a
// PowerShell-equivalent generator without doubling the generator surface
// area for a narrow case (agent CLIs like Claude Code already lean on
// Git-Bash-adjacent tooling on Windows in practice).
export function warnIfBashUnavailable(): void {
  if (process.platform !== "win32") return;
  if (commandExists("bash")) return;

  p.note(
    "No bash found on PATH. The generated verification script (.loop/verify.sh)\n" +
      "requires bash — install Git for Windows (includes Git Bash) or use WSL.",
    pc.yellow("Windows notice"),
  );
}

function getStartHint(agents: AgentType[]): string {
  const commands = agents.map((agent) => {
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
  });
  return commands.length === 1 ? commands[0] : commands.join(" / ");
}
