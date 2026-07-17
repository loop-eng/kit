import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectVerification } from "../verification.js";

describe("detectVerification", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kit-verify-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns vitest command for vitest runner", () => {
    const result = detectVerification(dir, "typescript", "vitest");
    expect(result.testCommand).toBe("npx vitest run");
  });

  it("returns jest command for jest runner", () => {
    const result = detectVerification(dir, "javascript", "jest");
    expect(result.testCommand).toBe("npx jest");
  });

  it("returns pytest command for pytest runner", () => {
    const result = detectVerification(dir, "python", "pytest");
    expect(result.testCommand).toBe("pytest");
  });

  it("returns go test for go-test runner", () => {
    const result = detectVerification(dir, "go", "go-test");
    expect(result.testCommand).toBe("go test ./...");
  });

  it("falls back to npm test if package.json has test script", () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { test: "vitest" } }),
    );
    const result = detectVerification(dir, "typescript", "unknown");
    expect(result.testCommand).toBe("npm test");
  });

  it("returns tsc --noEmit as build command for TypeScript", () => {
    const result = detectVerification(dir, "typescript", "vitest");
    expect(result.buildCommand).toBe("npx tsc --noEmit");
  });

  it("returns go build for Go", () => {
    const result = detectVerification(dir, "go", "go-test");
    expect(result.buildCommand).toBe("go build ./...");
  });

  it("detects eslint lint command when config exists", () => {
    writeFileSync(join(dir, "eslint.config.js"), "");
    const result = detectVerification(dir, "typescript", "vitest");
    expect(result.lintCommand).toBe("npx eslint .");
  });

  it("detects ruff lint command for Python", () => {
    writeFileSync(join(dir, "ruff.toml"), "");
    const result = detectVerification(dir, "python", "pytest");
    expect(result.lintCommand).toBe("ruff check .");
  });

  it("returns golangci-lint for Go", () => {
    const result = detectVerification(dir, "go", "go-test");
    expect(result.lintCommand).toBe("golangci-lint run ./...");
  });

  it("returns null lint for unknown stack", () => {
    const result = detectVerification(dir, "unknown", "unknown");
    expect(result.lintCommand).toBeNull();
  });
});
