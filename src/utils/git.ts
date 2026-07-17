import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function ensureGitignore(dir: string, entries: string[]): void {
  const gitignorePath = join(dir, ".gitignore");
  let content = "";

  try {
    if (existsSync(gitignorePath)) {
      content = readFileSync(gitignorePath, "utf-8");
    }

    const lines = content.split("\n").map((l) => l.trim());
    const missing = entries.filter(
      (entry) => !lines.includes(entry.trim()),
    );

    if (missing.length > 0) {
      const suffix = content.endsWith("\n") || content === "" ? "" : "\n";
      appendFileSync(
        gitignorePath,
        suffix + missing.join("\n") + "\n",
        "utf-8",
      );
    }
  } catch {
    // .gitignore update is non-critical
  }
}
