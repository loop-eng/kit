import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ProjectStack, TestRunner } from "../types.js";

export interface VerificationInfo {
  testCommand: string;
  buildCommand: string | null;
  lintCommand: string | null;
}

export function detectVerification(
  dir: string,
  stack: ProjectStack,
  testRunner: TestRunner,
): VerificationInfo {
  return {
    testCommand: resolveTestCommand(dir, stack, testRunner),
    buildCommand: resolveBuildCommand(dir, stack),
    lintCommand: resolveLintCommand(dir, stack),
  };
}

function resolveTestCommand(
  dir: string,
  stack: ProjectStack,
  testRunner: TestRunner,
): string {
  switch (testRunner) {
    case "vitest":
      return "npx vitest run";
    case "jest":
      return "npx jest";
    case "mocha":
      return "npx mocha";
    case "pytest":
      return "pytest";
    case "go-test":
      return "go test ./...";
    case "cargo-test":
      return "cargo test";
    case "unknown":
      return resolveTestFromScripts(dir, stack);
  }
}

function resolveTestFromScripts(dir: string, stack: ProjectStack): string {
  if (stack === "typescript" || stack === "javascript") {
    const pkg = readPackageJson(dir);
    if (pkg?.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
      return "npm test";
    }
  }
  return "echo 'No test command detected — configure one in .loop/budget.yaml' && exit 1";
}

function resolveBuildCommand(
  dir: string,
  stack: ProjectStack,
): string | null {
  switch (stack) {
    case "typescript":
      return "npx tsc --noEmit";
    case "go":
      return "go build ./...";
    case "rust":
      return "cargo build";
    case "javascript": {
      const pkg = readPackageJson(dir);
      if (pkg?.scripts?.build) return "npm run build";
      return null;
    }
    default:
      return null;
  }
}

function resolveLintCommand(
  dir: string,
  stack: ProjectStack,
): string | null {
  if (stack === "typescript" || stack === "javascript") {
    if (hasEslintConfig(dir)) return "npx eslint .";
  }
  if (stack === "python") {
    if (
      existsSync(join(dir, "ruff.toml")) ||
      hasRuffInPyproject(dir)
    )
      return "ruff check .";
    return null;
  }
  if (stack === "go") return "golangci-lint run ./...";
  if (stack === "rust") return "cargo clippy";
  return null;
}

function hasEslintConfig(dir: string): boolean {
  const patterns = [
    ".eslintrc",
    ".eslintrc.js",
    ".eslintrc.cjs",
    ".eslintrc.json",
    ".eslintrc.yml",
    ".eslintrc.yaml",
  ];
  if (patterns.some((p) => existsSync(join(dir, p)))) return true;

  try {
    const files = readdirSync(dir);
    return files.some((f) => f.startsWith("eslint.config."));
  } catch {
    return false;
  }
}

function hasRuffInPyproject(dir: string): boolean {
  const path = join(dir, "pyproject.toml");
  if (!existsSync(path)) return false;
  try {
    return readFileSync(path, "utf-8").includes("[tool.ruff");
  } catch {
    return false;
  }
}

function readPackageJson(
  dir: string,
): { scripts?: Record<string, string> } | null {
  const path = join(dir, "package.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}
