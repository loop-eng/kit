import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import type { Template } from "../types.js";

let cachedTemplates: Template[] | null = null;

export function getBuiltinTemplatesDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const srcDir = dirname(thisFile);
  // In dev: src/templates/registry.ts -> ../../templates
  // In dist: dist/cli.js -> ../templates
  const candidates = [
    join(srcDir, "..", "templates"),
    join(srcDir, "..", "..", "templates"),
  ];
  for (const dir of candidates) {
    try {
      const entries = readdirSync(dir);
      if (entries.some((f) => f.endsWith(".yaml") || f.endsWith(".yml"))) {
        return dir;
      }
    } catch {
      continue;
    }
  }
  return candidates[0];
}

export function loadBuiltinTemplates(): Template[] {
  if (cachedTemplates) return cachedTemplates;

  const dir = getBuiltinTemplatesDir();
  const templates: Template[] = [];

  try {
    const files = readdirSync(dir).filter(
      (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
    );

    for (const file of files) {
      try {
        const content = readFileSync(join(dir, file), "utf-8");
        const parsed = parse(content) as Partial<Template>;
        if (
          typeof parsed?.name === "string" &&
          typeof parsed?.description === "string" &&
          typeof parsed?.goal === "string" &&
          typeof parsed?.verification?.command === "string" &&
          typeof parsed?.budget?.suggested_usd === "number" &&
          typeof parsed?.budget?.suggested_iterations === "number"
        ) {
          if (!Array.isArray(parsed.tags)) parsed.tags = [];
          if (!parsed.agent_instructions) parsed.agent_instructions = {};
          templates.push(parsed as Template);
        }
      } catch {
        // skip malformed templates
      }
    }
  } catch {
    // templates dir not found
  }

  cachedTemplates = templates;
  return templates;
}

export function findTemplate(name: string): Template | undefined {
  return loadBuiltinTemplates().find((t) => t.name === name);
}

export function searchTemplates(query: string): Template[] {
  const q = query.toLowerCase();
  return loadBuiltinTemplates().filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.tags.some((tag) => tag.toLowerCase().includes(q)),
  );
}

export function listTemplates(): Template[] {
  return loadBuiltinTemplates();
}
