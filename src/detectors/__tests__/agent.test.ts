import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// node:child_process's ESM module namespace is non-configurable, so
// vi.spyOn can't intercept its named exports directly — vi.mock is
// required instead. Default behavior simulates "command not found" (throws)
// so the file-presence-based detectAgent tests below are unaffected by
// whatever agent CLIs happen to be installed on the machine running tests.
const execFileSyncMock = vi.fn<(...args: unknown[]) => Buffer>(() => {
  throw new Error("not found");
});
vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}));

const { detectAgent, commandExists } = await import("../agent.js");

describe("detectAgent", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kit-agent-"));
    execFileSyncMock.mockImplementation(() => {
      throw new Error("not found");
    });
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

  it("returns empty array for bare directory when no agent CLI is on PATH", () => {
    const agents = detectAgent(dir);
    expect(agents).toEqual([]);
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

  it("falls back to CLI detection when no config file is present", () => {
    execFileSyncMock.mockImplementation(() => Buffer.from(""));
    const agents = detectAgent(dir);
    expect(agents).toEqual(["claude-code", "codex", "gemini"]);
  });
});

describe("commandExists — platform-conditional lookup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    execFileSyncMock.mockImplementation(() => {
      throw new Error("not found");
    });
  });

  it("uses 'where' on win32", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    execFileSyncMock.mockImplementation(() => Buffer.from(""));

    commandExists("claude");

    expect(execFileSyncMock).toHaveBeenCalledWith("where", ["claude"], { stdio: "ignore" });
  });

  it("uses 'which' on non-win32 platforms", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    execFileSyncMock.mockImplementation(() => Buffer.from(""));

    commandExists("claude");

    expect(execFileSyncMock).toHaveBeenCalledWith("which", ["claude"], { stdio: "ignore" });
  });

  it("returns false when the lookup command throws (tool not found)", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    execFileSyncMock.mockImplementation(() => {
      throw new Error("not found");
    });

    expect(commandExists("nonexistent-tool")).toBe(false);
  });

  it("returns true when the lookup command succeeds", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    execFileSyncMock.mockImplementation(() => Buffer.from("/usr/bin/node"));

    expect(commandExists("node")).toBe(true);
  });
});
