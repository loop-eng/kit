import { stringify } from "yaml";

export function generateLtfConfig(): string {
  const config = {
    ltf: {
      version: "1.0",
      output: ".loop/trace.ltf.jsonl",
      format: "jsonl",
      fields: {
        timestamp: true,
        iteration: true,
        action: true,
        result: true,
        cost_usd: true,
        tokens: true,
        duration_ms: true,
      },
      retention: {
        max_entries: 1000,
        max_size_mb: 10,
      },
    },
  };

  return stringify(config);
}
