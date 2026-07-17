import { Command } from "commander";
import pc from "picocolors";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { fileExists, readFileSafe } from "../utils/fs.js";
import { detectAll } from "../detectors/index.js";

interface ScoreItem {
  label: string;
  points: number;
  maxPoints: number;
  present: boolean;
}

export const scoreCommand = new Command("score")
  .description("Rate loop readiness (0-100)")
  .option("-d, --dir <path>", "project directory", ".")
  .action(async (opts: { dir: string }) => {
    const dir = resolve(opts.dir);

    if (!existsSync(dir)) {
      // eslint-disable-next-line no-console
      console.log(pc.red(`Directory not found: ${opts.dir}`));
      process.exit(1);
    }

    const items = evaluateReadiness(dir);

    const total = items.reduce((s, i) => s + i.maxPoints, 0);
    const earned = items.reduce((s, i) => s + i.points, 0);
    const score = Math.round((earned / total) * 100);

    const scoreColor =
      score >= 80 ? pc.green : score >= 50 ? pc.yellow : pc.red;

    // eslint-disable-next-line no-console
    console.log(
      `\n${pc.bold("Loop Readiness Score:")} ${scoreColor(pc.bold(String(score)))}${pc.dim("/100")}\n`,
    );

    for (const item of items) {
      const icon = item.present ? pc.green("✓") : pc.red("✗");
      const padded = item.label.padEnd(40);
      const label = item.present ? padded : pc.dim(padded);
      // eslint-disable-next-line no-console
      console.log(
        `  ${icon} ${label} ${pc.dim(`${item.points}/${item.maxPoints}`)}`,
      );
    }

    // eslint-disable-next-line no-console
    console.log();

    if (score < 50) {
      // eslint-disable-next-line no-console
      console.log(
        pc.yellow(
          "  Run `kit init` to scaffold missing configuration.\n",
        ),
      );
    } else if (score < 80) {
      // eslint-disable-next-line no-console
      console.log(
        pc.dim(
          "  Good foundation. Add missing items to reach production readiness.\n",
        ),
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(
        pc.green("  Production ready! Start your loop.\n"),
      );
    }
  });

function evaluateReadiness(dir: string): ScoreItem[] {
  const detection = detectAll(dir);
  const items: ScoreItem[] = [];

  const check = (
    label: string,
    maxPoints: number,
    present: boolean,
  ) => {
    items.push({ label, maxPoints, points: present ? maxPoints : 0, present });
  };

  check(
    "Agent config (CLAUDE.md/AGENTS.md/GEMINI.md)",
    15,
    fileExists(join(dir, "CLAUDE.md")) ||
      fileExists(join(dir, "AGENTS.md")) ||
      fileExists(join(dir, "GEMINI.md")) ||
      fileExists(join(dir, ".cursorrules")),
  );

  check(
    "Goal definition (.loop/goal.md)",
    15,
    fileExists(join(dir, ".loop/goal.md")),
  );

  check(
    "Verification gate (.loop/verify.sh)",
    15,
    fileExists(join(dir, ".loop/verify.sh")) ||
      fileExists(join(dir, ".claude/hooks/verify.sh")),
  );

  check(
    "Budget configuration (.loop/budget.yaml)",
    10,
    fileExists(join(dir, ".loop/budget.yaml")),
  );

  check(
    "State tracking (.loop/state.md)",
    10,
    fileExists(join(dir, ".loop/state.md")),
  );

  check(
    "LTF trace config (.loop/ltf.config.yaml)",
    5,
    fileExists(join(dir, ".loop/ltf.config.yaml")),
  );

  check(
    "Stack detected",
    10,
    detection.stack !== "unknown",
  );

  check(
    "Test runner detected",
    10,
    detection.testRunner !== "unknown",
  );

  check(
    "Agent installed",
    5,
    detection.agents.length > 0,
  );

  const hasConvergenceCriteria = (() => {
    const content = readFileSafe(join(dir, ".loop/budget.yaml"));
    return content ? content.includes("convergence") : false;
  })();

  check(
    "Convergence criteria configured",
    5,
    hasConvergenceCriteria,
  );

  return items;
}
