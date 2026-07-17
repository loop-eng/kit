import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ProjectStack } from "../types.js";

export function detect(dir: string): ProjectStack {
  if (existsSync(join(dir, "tsconfig.json"))) return "typescript";
  if (existsSync(join(dir, "package.json"))) return "javascript";
  if (
    existsSync(join(dir, "pyproject.toml")) ||
    existsSync(join(dir, "setup.py"))
  )
    return "python";
  if (existsSync(join(dir, "go.mod"))) return "go";
  if (existsSync(join(dir, "Cargo.toml"))) return "rust";
  return "unknown";
}
