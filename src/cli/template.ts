import { Command } from "commander";
import pc from "picocolors";
import { listTemplates, searchTemplates } from "../templates/registry.js";

export const templateCommand = new Command("templates")
  .description("Browse available loop templates")
  .option("-s, --search <query>", "search templates by name or tag")
  .action(async (opts: { search?: string }) => {
    const templates = opts.search
      ? searchTemplates(opts.search)
      : listTemplates();

    if (templates.length === 0) {
      if (opts.search) {
        // eslint-disable-next-line no-console
        console.log(`No templates matching "${opts.search}"`);
      } else {
        // eslint-disable-next-line no-console
        console.log("No templates found");
      }
      return;
    }

    // eslint-disable-next-line no-console
    console.log(
      `\n${pc.bold("Available Templates")} ${pc.dim(`(${templates.length})`)}\n`,
    );

    for (const t of templates) {
      const tags = t.tags.map((tag) => pc.dim(`#${tag}`)).join(" ");
      // eslint-disable-next-line no-console
      console.log(
        `  ${pc.cyan(t.name.padEnd(22))} ${t.description}`,
      );
      // eslint-disable-next-line no-console
      console.log(
        `  ${"".padEnd(22)} ${tags}  ${pc.dim(`$${t.budget.suggested_usd} · ${t.budget.suggested_iterations} iterations`)}`,
      );
      // eslint-disable-next-line no-console
      console.log();
    }

    // eslint-disable-next-line no-console
    console.log(
      pc.dim("  Use: kit init --template <name> to scaffold a loop\n"),
    );
  });
