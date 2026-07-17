import { describe, it, expect } from "vitest";
import { generateHooks } from "../hooks.js";

describe("generateHooks", () => {
  it("generates valid bash with shebang", () => {
    const result = generateHooks("npm test");
    expect(result).toContain("#!/usr/bin/env bash");
    expect(result).toContain("npm test");
  });

  it("escapes single quotes in verify command", () => {
    const result = generateHooks("echo 'hello world'");
    expect(result).toContain("echo '\\''hello world'\\''");
    expect(result).not.toContain("echo 'Running verification: echo 'hello");
  });

  it("handles commands without single quotes", () => {
    const result = generateHooks("npm test");
    expect(result).toContain("Running verification: npm test");
  });

  it("preserves the actual command unescaped for execution", () => {
    const result = generateHooks("echo 'test'");
    const lines = result.split("\n");
    const execLine = lines.find((l) => l.trim() === "echo 'test'");
    expect(execLine).toBeTruthy();
  });

  it("captures exit code correctly", () => {
    const result = generateHooks("npm test");
    expect(result).toContain("set +e");
    expect(result).toContain("exit_code=$?");
    expect(result).toContain("set -e");
  });
});
