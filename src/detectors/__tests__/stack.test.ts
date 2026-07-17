import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detect } from "../stack.js";

describe("detect", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kit-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects TypeScript project", () => {
    writeFileSync(join(dir, "tsconfig.json"), "{}");
    expect(detect(dir)).toBe("typescript");
  });

  it("detects JavaScript project", () => {
    writeFileSync(join(dir, "package.json"), "{}");
    expect(detect(dir)).toBe("javascript");
  });

  it("detects Python project via pyproject.toml", () => {
    writeFileSync(join(dir, "pyproject.toml"), "");
    expect(detect(dir)).toBe("python");
  });

  it("detects Go project", () => {
    writeFileSync(join(dir, "go.mod"), "module example");
    expect(detect(dir)).toBe("go");
  });

  it("detects Rust project", () => {
    writeFileSync(join(dir, "Cargo.toml"), "");
    expect(detect(dir)).toBe("rust");
  });

  it("returns unknown for empty directory", () => {
    expect(detect(dir)).toBe("unknown");
  });

  it("prioritizes TypeScript over JavaScript", () => {
    writeFileSync(join(dir, "tsconfig.json"), "{}");
    writeFileSync(join(dir, "package.json"), "{}");
    expect(detect(dir)).toBe("typescript");
  });
});
