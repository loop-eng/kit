import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TestRunner } from "../types.js";

export function detectTestRunner(dir: string): TestRunner {
  if (hasFile(dir, "vitest.config.ts") || hasFile(dir, "vitest.config.js"))
    return "vitest";
  if (hasFile(dir, "jest.config.ts") || hasFile(dir, "jest.config.js"))
    return "jest";
  if (hasFile(dir, ".mocharc.yml") || hasFile(dir, ".mocharc.json"))
    return "mocha";
  if (hasFile(dir, "pytest.ini") || hasPytestInPyproject(dir)) return "pytest";
  if (hasFile(dir, "go.mod")) return "go-test";
  if (hasFile(dir, "Cargo.toml")) return "cargo-test";
  return "unknown";
}

function hasFile(dir: string, name: string): boolean {
  return existsSync(join(dir, name));
}

function hasPytestInPyproject(dir: string): boolean {
  const path = join(dir, "pyproject.toml");
  if (!existsSync(path)) return false;
  try {
    const content = readFileSync(path, "utf-8");
    return content.includes("[tool.pytest");
  } catch {
    return false;
  }
}
