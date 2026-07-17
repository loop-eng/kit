import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { initCommand } from "./init.js";
import { templateCommand } from "./template.js";
import { statusCommand } from "./status.js";
import { scoreCommand } from "./score.js";

function loadVersion(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(thisDir, "..", "package.json"),
    join(thisDir, "..", "..", "package.json"),
  ];
  for (const p of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(p, "utf-8"));
      if (pkg.name === "@loop-eng/kit") return pkg.version;
    } catch { /* skip */ }
  }
  return "0.0.0";
}

const program = new Command();

program
  .name("kit")
  .description(
    "Create production-ready agent loops in 30 seconds — zero to loop with one command",
  )
  .version(loadVersion());

program.addCommand(initCommand);
program.addCommand(templateCommand);
program.addCommand(statusCommand);
program.addCommand(scoreCommand);

program.parseAsync().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
