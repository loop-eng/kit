import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureGitignore } from "../git.js";

describe("ensureGitignore", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kit-git-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates .gitignore if it does not exist", () => {
    ensureGitignore(dir, [".loop/state.md"]);
    const content = readFileSync(join(dir, ".gitignore"), "utf-8");
    expect(content).toContain(".loop/state.md");
  });

  it("appends entries to existing .gitignore", () => {
    writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
    ensureGitignore(dir, [".loop/state.md"]);
    const content = readFileSync(join(dir, ".gitignore"), "utf-8");
    expect(content).toContain("node_modules/");
    expect(content).toContain(".loop/state.md");
  });

  it("does not duplicate existing entries", () => {
    writeFileSync(join(dir, ".gitignore"), ".loop/state.md\n");
    ensureGitignore(dir, [".loop/state.md"]);
    const content = readFileSync(join(dir, ".gitignore"), "utf-8");
    const count = content.split(".loop/state.md").length - 1;
    expect(count).toBe(1);
  });

  it("handles .gitignore without trailing newline", () => {
    writeFileSync(join(dir, ".gitignore"), "node_modules/");
    ensureGitignore(dir, [".loop/state.md"]);
    const content = readFileSync(join(dir, ".gitignore"), "utf-8");
    expect(content).toBe("node_modules/\n.loop/state.md\n");
  });

  it("handles multiple entries at once", () => {
    ensureGitignore(dir, [".loop/state.md", ".loop/trace.ltf.jsonl"]);
    const content = readFileSync(join(dir, ".gitignore"), "utf-8");
    expect(content).toContain(".loop/state.md");
    expect(content).toContain(".loop/trace.ltf.jsonl");
  });
});
