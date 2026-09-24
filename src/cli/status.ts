import { Command } from "commander";
import pc from "picocolors";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { readFileSafe, fileExists } from "../utils/fs.js";
import { LTF_TRACE_PATH } from "../utils/ltf-paths.js";
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

interface TokenUsage {
  input?: number;
  output?: number;
  cached?: number;
  cache_write?: number;
}

export interface TraceEvent {
  ltf_version?: string;
  loop_id?: string;
  timestamp?: string;
  phase?: "plan" | "act" | "verify" | "decide" | "error" | "terminate";
  iteration?: number;
  action?: { type?: string; target?: string; detail?: string };
  tokens?: TokenUsage;
  cost_usd?: number;
  duration_ms?: number;
  result?: { status?: string; detail?: string; files_changed?: string[] };
  verification?: { command?: string; exit_code?: number; output_summary?: string };
}

export interface LoopSummary {
  type: "loop_summary";
  loop_id?: string;
  started_at?: string;
  ended_at?: string;
  total_iterations?: number;
  total_tokens?: TokenUsage;
  total_cost_usd?: number;
  total_duration_ms?: number;
  termination_reason?: string;
}

type TraceRecord = TraceEvent | LoopSummary;

function isLoopSummary(r: TraceRecord): r is LoopSummary {
  return (r as LoopSummary).type === "loop_summary";
}

interface TraceReadResult {
  records: TraceRecord[];
  malformedCount: number;
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

    const { records, malformedCount } = readTraces(dir);
    if (records.length > 0 || malformedCount > 0) {
      const summaries = records.filter(isLoopSummary);
      const events = records.filter((r): r is TraceEvent => !isLoopSummary(r));
      const latestSummary = summaries[summaries.length - 1];

      const totalCost =
        latestSummary?.total_cost_usd ??
        events.reduce((sum, e) => sum + (e.cost_usd ?? 0), 0);
      const totalTokens =
        latestSummary?.total_tokens !== undefined
          ? (latestSummary.total_tokens.input ?? 0) + (latestSummary.total_tokens.output ?? 0)
          : events.reduce(
              (sum, e) => sum + (e.tokens?.input ?? 0) + (e.tokens?.output ?? 0),
              0,
            );
      const totalDuration =
        latestSummary?.total_duration_ms ??
        events.reduce((sum, e) => sum + (e.duration_ms ?? 0), 0);

      // eslint-disable-next-line no-console
      console.log();
      const entryLabel =
        malformedCount > 0
          ? `${records.length} entries (${malformedCount} malformed, skipped)`
          : `${records.length} entries`;
      // eslint-disable-next-line no-console
      console.log(`  Traces:   ${pc.dim(entryLabel)}`);
      if (latestSummary?.termination_reason) {
        // eslint-disable-next-line no-console
        console.log(`    Ended:    ${latestSummary.termination_reason}`);
      }
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

export function readLoopState(dir: string): LoopState | null {
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

export function readBudgetState(dir: string): BudgetState | null {
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

export function readTraces(dir: string): TraceReadResult {
  const content = readFileSafe(join(dir, LTF_TRACE_PATH));
  if (!content) return { records: [], malformedCount: 0 };

  const records: TraceRecord[] = [];
  let malformedCount = 0;

  for (const line of content.trim().split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line) as TraceRecord);
    } catch {
      malformedCount++;
    }
  }

  return { records, malformedCount };
}
