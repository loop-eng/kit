import { describe, it, expect } from "vitest";
import {
  listTemplates,
  findTemplate,
  searchTemplates,
} from "../registry.js";

describe("template registry", () => {
  it("loads all built-in templates", () => {
    const templates = listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(6);
  });

  it("each template has required fields", () => {
    for (const t of listTemplates()) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.tags).toBeInstanceOf(Array);
      expect(t.goal).toBeTruthy();
      expect(t.verification.command).toBeTruthy();
      expect(t.budget.suggested_usd).toBeGreaterThan(0);
      expect(t.budget.suggested_iterations).toBeGreaterThan(0);
    }
  });

  it("finds template by exact name", () => {
    const t = findTemplate("fix-types");
    expect(t).toBeTruthy();
    expect(t?.name).toBe("fix-types");
  });

  it("returns undefined for unknown template", () => {
    expect(findTemplate("nonexistent")).toBeUndefined();
  });

  it("searches templates by name", () => {
    const results = searchTemplates("fix");
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.some((t) => t.name === "fix-types")).toBe(true);
    expect(results.some((t) => t.name === "fix-lint")).toBe(true);
  });

  it("searches templates by tag", () => {
    const results = searchTemplates("security");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe("security-audit");
  });

  it("returns empty array for no matches", () => {
    const results = searchTemplates("zzzznonexistent");
    expect(results).toEqual([]);
  });
});
