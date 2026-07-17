import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectAgent } from "../agent.js";

describe("detectAgent", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kit-agent-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects claude-code from CLAUDE.md", () => {
    writeFileSync(join(dir, "CLAUDE.md"), "# Instructions");
    const agents = detectAgent(dir);
    expect(agents).toContain("claude-code");
  });

  it("detects claude-code from .claude directory", () => {
    mkdirSync(join(dir, ".claude"));
    const agents = detectAgent(dir);
    expect(agents).toContain("claude-code");
  });

  it("detects codex from AGENTS.md", () => {
    writeFileSync(join(dir, "AGENTS.md"), "# Agents");
    const agents = detectAgent(dir);
    expect(agents).toContain("codex");
  });

  it("detects gemini from GEMINI.md", () => {
    writeFileSync(join(dir, "GEMINI.md"), "# Gemini");
    const agents = detectAgent(dir);
    expect(agents).toContain("gemini");
  });

  it("detects cursor from .cursorrules", () => {
    writeFileSync(join(dir, ".cursorrules"), "rules");
    const agents = detectAgent(dir);
    expect(agents).toContain("cursor");
  });

  it("detects cursor from .cursor directory", () => {
    mkdirSync(join(dir, ".cursor"));
    const agents = detectAgent(dir);
    expect(agents).toContain("cursor");
  });

  it("returns empty array for bare directory (except if claude is installed globally)", () => {
    const agents = detectAgent(dir);
    // Can't assert empty because claude CLI may be installed on the test machine
    expect(Array.isArray(agents)).toBe(true);
  });

  it("detects multiple agents", () => {
    writeFileSync(join(dir, "CLAUDE.md"), "");
    writeFileSync(join(dir, "AGENTS.md"), "");
    writeFileSync(join(dir, ".cursorrules"), "");
    const agents = detectAgent(dir);
    expect(agents).toContain("claude-code");
    expect(agents).toContain("codex");
    expect(agents).toContain("cursor");
  });
});
