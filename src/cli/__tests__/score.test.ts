import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { evaluateReadiness } from "../score.js";

describe("evaluateReadiness — multi-agent scoring", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kit-score-"));
    mkdirSync(join(dir, ".loop"), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function agentConfigItem(items: ReturnType<typeof evaluateReadiness>) {
    return items.find((i) => i.label.startsWith("Agent config"));
  }

  it("falls back to legacy OR-check when no manifest exists", () => {
    writeFileSync(join(dir, "CLAUDE.md"), "# loop");
    const item = agentConfigItem(evaluateReadiness(dir));
    expect(item?.label).toBe("Agent config (CLAUDE.md/AGENTS.md/GEMINI.md)");
    expect(item?.points).toBe(15);
    expect(item?.present).toBe(true);
  });

  it("gives full credit when all manifest-recorded agents have their config file present", () => {
    writeFileSync(join(dir, ".loop/kit.json"), JSON.stringify({ agents: ["claude-code", "codex"] }));
    writeFileSync(join(dir, "CLAUDE.md"), "# loop");
    writeFileSync(join(dir, "AGENTS.md"), "# loop");

    const item = agentConfigItem(evaluateReadiness(dir));
    expect(item?.label).toBe("Agent config (2/2 agents)");
    expect(item?.points).toBe(15);
    expect(item?.present).toBe(true);
  });

  it("gives proportional credit when only some manifest-recorded agents have their file present", () => {
    writeFileSync(join(dir, ".loop/kit.json"), JSON.stringify({ agents: ["claude-code", "codex"] }));
    writeFileSync(join(dir, "CLAUDE.md"), "# loop");
    // AGENTS.md intentionally missing

    const item = agentConfigItem(evaluateReadiness(dir));
    expect(item?.label).toBe("Agent config (1/2 agents)");
    expect(item?.points).toBe(8); // round(1/2 * 15) = 8
    expect(item?.present).toBe(false);
  });

  it("gives zero credit when no manifest-recorded agent has its file present", () => {
    writeFileSync(join(dir, ".loop/kit.json"), JSON.stringify({ agents: ["gemini"] }));

    const item = agentConfigItem(evaluateReadiness(dir));
    expect(item?.label).toBe("Agent config (0/1 agents)");
    expect(item?.points).toBe(0);
  });

  it("falls back to legacy check when manifest is malformed", () => {
    writeFileSync(join(dir, ".loop/kit.json"), "{not valid json");
    writeFileSync(join(dir, "CLAUDE.md"), "# loop");

    const item = agentConfigItem(evaluateReadiness(dir));
    expect(item?.label).toBe("Agent config (CLAUDE.md/AGENTS.md/GEMINI.md)");
  });

  it("falls back to legacy check when manifest has no agents array", () => {
    writeFileSync(join(dir, ".loop/kit.json"), JSON.stringify({ notAgents: true }));
    writeFileSync(join(dir, "CLAUDE.md"), "# loop");

    const item = agentConfigItem(evaluateReadiness(dir));
    expect(item?.label).toBe("Agent config (CLAUDE.md/AGENTS.md/GEMINI.md)");
  });
});
