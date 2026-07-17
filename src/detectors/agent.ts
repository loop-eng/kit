import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { AgentType } from "../types.js";

export function detectAgent(dir: string): AgentType[] {
  const agents: AgentType[] = [];

  if (
    existsSync(join(dir, "CLAUDE.md")) ||
    existsSync(join(dir, ".claude")) ||
    commandExists("claude")
  ) {
    agents.push("claude-code");
  }

  if (existsSync(join(dir, "AGENTS.md")) || commandExists("codex")) {
    agents.push("codex");
  }

  if (existsSync(join(dir, "GEMINI.md")) || commandExists("gemini")) {
    agents.push("gemini");
  }

  if (
    existsSync(join(dir, ".cursor")) ||
    existsSync(join(dir, ".cursorrules"))
  ) {
    agents.push("cursor");
  }

  return agents;
}

function commandExists(cmd: string): boolean {
  try {
    const lookup = process.platform === "win32" ? "where" : "which";
    execFileSync(lookup, [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
