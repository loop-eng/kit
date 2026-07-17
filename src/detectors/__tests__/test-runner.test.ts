import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectTestRunner } from "../test-runner.js";

describe("detectTestRunner", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kit-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects vitest", () => {
    writeFileSync(join(dir, "vitest.config.ts"), "");
    expect(detectTestRunner(dir)).toBe("vitest");
  });

  it("detects jest", () => {
    writeFileSync(join(dir, "jest.config.js"), "");
    expect(detectTestRunner(dir)).toBe("jest");
  });

  it("detects pytest from pyproject.toml", () => {
    writeFileSync(join(dir, "pyproject.toml"), "[tool.pytest.ini_options]");
    expect(detectTestRunner(dir)).toBe("pytest");
  });

  it("detects go test", () => {
    writeFileSync(join(dir, "go.mod"), "module example");
    expect(detectTestRunner(dir)).toBe("go-test");
  });

  it("detects cargo test", () => {
    writeFileSync(join(dir, "Cargo.toml"), "");
    expect(detectTestRunner(dir)).toBe("cargo-test");
  });

  it("returns unknown for empty directory", () => {
    expect(detectTestRunner(dir)).toBe("unknown");
  });
});
