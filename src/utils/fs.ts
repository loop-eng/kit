import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export function writeFileSafe(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

export function readFileSafe(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

export function fileExists(path: string): boolean {
  return existsSync(path);
}
