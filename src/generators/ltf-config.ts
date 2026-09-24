import { stringify } from "yaml";
import { LTF_TRACE_PATH, LTF_VERSION } from "../utils/ltf-paths.js";

export function generateLtfConfig(): string {
  const config = {
    ltf: {
      version: LTF_VERSION,
      output: LTF_TRACE_PATH,
      format: "jsonl",
      // Always present on every emitted event/record — not configurable.
      required_fields: ["ltf_version", "loop_id", "timestamp", "phase"],
      // What the generated verify.sh hook actually populates today.
      // cost_usd/tokens are NOT captured: the verification script has no
      // visibility into the agent's own model calls. Only verification
      // outcomes are observable from this integration point.
      captured: {
        phase: "verify only (no plan/act/decide granularity)",
        iteration: "counted per verification run, independent of state.md",
        verification: true,
        duration_ms: true,
        loop_summary: "emitted once, only on the first passing verification",
      },
      not_captured: ["cost_usd", "tokens", "agent", "files_changed", "context"],
      retention: {
        max_entries: 1000,
        max_size_mb: 10,
        enforced: false,
      },
    },
  };

  return stringify(config);
}
