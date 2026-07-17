import { Command } from "commander";
import pc from "picocolors";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { readFileSafe, fileExists } from "../utils/fs.js";
import { parse } from "yaml";

interface LoopState {
  iteration: number;
  status: string;
  progress: string[];
}

interface BudgetState {
  max_cost_usd: number | null;
  max_iterations: number | null;
}

interface TraceEntry {
  timestamp?: string;
  iteration?: number;
  action?: string;
  result?: string;
  cost_usd?: number;
  tokens?: number;
  duration_ms?: number;
}

export const statusCommand = new Command("status")
  .description("Show loop progress from LTF traces")
  .option("-d, --dir <path>", "project directory", ".")
  .action(async (opts: { dir: string }) => {
    const dir = resolve(opts.dir);

    if (!existsSync(dir)) {
      // eslint-disable-next-line no-console
      console.log(pc.red(`Directory not found: ${opts.dir}`));
      process.exit(1);
    }

    const hasLoop = fileExists(join(dir, ".loop"));
    if (!hasLoop) {
      // eslint-disable-next-line no-console
      console.log(
        pc.yellow("No loop configured. Run `kit init` to get started."),
      );
      return;
    }

    // eslint-disable-next-line no-console
    console.log(`\n${pc.bold("Loop Status")}\n`);

    const state = readLoopState(dir);
    if (state) {
      const statusColor =
        state.status === "complete"
          ? pc.green
          : state.status === "running"
            ? pc.cyan
            : pc.dim;
      // eslint-disable-next-line no-console
      console.log(`  Status:     ${statusColor(state.status)}`);
      // eslint-disable-next-line no-console
      console.log(`  Iteration:  ${pc.bold(String(state.iteration))}`);
      if (state.progress.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`  Progress:`);
        for (const line of state.progress.slice(-5)) {
          // eslint-disable-next-line no-console
          console.log(`    ${line}`);
        }
      }
    } else {
      // eslint-disable-next-line no-console
      console.log(`  ${pc.dim("No state file found (.loop/state.md)")}`);
    }

    const budget = readBudgetState(dir);
    if (budget) {
      // eslint-disable-next-line no-console
      console.log();
      // eslint-disable-next-line no-console
      console.log(`  Budget:`);
      if (budget.max_cost_usd !== null) {
        // eslint-disable-next-line no-console
        console.log(
          `    Cost cap:       $${budget.max_cost_usd}`,
        );
      }
      if (budget.max_iterations !== null) {
        // eslint-disable-next-line no-console
        console.log(
          `    Iteration cap:  ${budget.max_iterations}`,
        );
      }
    }

    const traces = readTraces(dir);
    if (traces.length > 0) {
      const totalCost = traces.reduce(
        (sum, t) => sum + (t.cost_usd ?? 0),
        0,
      );
      const totalTokens = traces.reduce(
        (sum, t) => sum + (t.tokens ?? 0),
        0,
      );
      const totalDuration = traces.reduce(
        (sum, t) => sum + (t.duration_ms ?? 0),
        0,
      );

      // eslint-disable-next-line no-console
      console.log();
      // eslint-disable-next-line no-console
      console.log(`  Traces:   ${pc.dim(`${traces.length} entries`)}`);
      if (totalCost > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `    Spent:    $${totalCost.toFixed(2)}`,
        );
      }
      if (totalTokens > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `    Tokens:   ${totalTokens.toLocaleString()}`,
        );
      }
      if (totalDuration > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `    Duration: ${(totalDuration / 1000).toFixed(1)}s`,
        );
      }
    }

    // eslint-disable-next-line no-console
    console.log();
  });

function readLoopState(dir: string): LoopState | null {
  const content = readFileSafe(join(dir, ".loop/state.md"));
  if (!content) return null;

  const iterationMatch = content.match(
    /## Current Iteration\s*\n(\d+)/,
  );
  const statusMatch = content.match(
    /## Status\s*\n(\w+)/,
  );
  const progressMatch = content.match(
    /## Progress\s*\n([\s\S]*?)(?=\n##|$)/,
  );

  return {
    iteration: iterationMatch ? parseInt(iterationMatch[1], 10) : 0,
    status: statusMatch ? statusMatch[1] : "unknown",
    progress: progressMatch
      ? progressMatch[1]
          .trim()
          .split("\n")
          .filter((l) => l.trim())
      : [],
  };
}

function readBudgetState(dir: string): BudgetState | null {
  const content = readFileSafe(join(dir, ".loop/budget.yaml"));
  if (!content) return null;

  try {
    const parsed = parse(content) as {
      budget?: { max_cost_usd?: number; max_iterations?: number };
    };
    return {
      max_cost_usd: parsed?.budget?.max_cost_usd ?? null,
      max_iterations: parsed?.budget?.max_iterations ?? null,
    };
  } catch {
    return null;
  }
}

function readTraces(dir: string): TraceEntry[] {
  const content = readFileSafe(join(dir, ".loop/trace.ltf.jsonl"));
  if (!content) return [];

  return content
    .trim()
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line) as TraceEntry;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is TraceEntry => entry !== null);
}
