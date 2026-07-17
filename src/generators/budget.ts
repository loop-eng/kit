import { stringify } from "yaml";

interface BudgetOptions {
  maxCostUsd: number;
  maxIterations: number;
  maxDurationMinutes: number;
  verifyCommand: string;
}

export function generateBudget(opts: BudgetOptions): string {
  const config = {
    budget: {
      max_cost_usd: opts.maxCostUsd > 0 ? opts.maxCostUsd : null,
      max_iterations: opts.maxIterations > 0 ? opts.maxIterations : null,
      max_duration_minutes: opts.maxDurationMinutes > 0 ? opts.maxDurationMinutes : null,
    },
    verification: {
      command: opts.verifyCommand,
      must_pass: true,
      retry_on_fail: true,
    },
    convergence: {
      stall_iterations: 3,
      same_error_threshold: 2,
    },
    ltf: {
      enabled: true,
      output: ".loop/trace.ltf.jsonl",
    },
  };

  return stringify(config);
}
