import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readLoopState, readBudgetState, readTraces } from "../status.js";

describe("readLoopState", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kit-status-"));
    mkdirSync(join(dir, ".loop"), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when state.md doesn't exist", () => {
    expect(readLoopState(dir)).toBeNull();
  });

  it("parses iteration, status, and progress", () => {
    writeFileSync(
      join(dir, ".loop/state.md"),
      "# Loop State\n\n## Current Iteration\n3\n\n## Status\nrunning\n\n## Progress\n- [x] step one\n- [ ] step two\n",
    );
    const state = readLoopState(dir);
    expect(state).toEqual({
      iteration: 3,
      status: "running",
      progress: ["- [x] step one", "- [ ] step two"],
    });
  });
});

describe("readBudgetState", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kit-status-"));
    mkdirSync(join(dir, ".loop"), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when budget.yaml doesn't exist", () => {
    expect(readBudgetState(dir)).toBeNull();
  });

  it("distinguishes an explicit cap from unlimited (null)", () => {
    writeFileSync(
      join(dir, ".loop/budget.yaml"),
      "budget:\n  max_cost_usd: 20\n  max_iterations: null\n",
    );
    expect(readBudgetState(dir)).toEqual({ max_cost_usd: 20, max_iterations: null });
  });
});

describe("readTraces", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kit-status-"));
    mkdirSync(join(dir, ".loop"), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty result when trace file doesn't exist", () => {
    expect(readTraces(dir)).toEqual({ records: [], malformedCount: 0 });
  });

  it("parses valid phase-event and loop_summary records", () => {
    const lines = [
      JSON.stringify({ ltf_version: "1.0", loop_id: "x", timestamp: "t", phase: "verify", iteration: 1, result: { status: "success" } }),
      JSON.stringify({ ltf_version: "1.0", type: "loop_summary", loop_id: "x", total_iterations: 1, total_duration_ms: 500, termination_reason: "goal_met" }),
    ];
    writeFileSync(join(dir, ".loop/trace.ltf.jsonl"), lines.join("\n") + "\n");

    const { records, malformedCount } = readTraces(dir);
    expect(records).toHaveLength(2);
    expect(malformedCount).toBe(0);
  });

  it("counts malformed lines instead of silently dropping them (parse-failure visibility)", () => {
    const content = [
      JSON.stringify({ ltf_version: "1.0", loop_id: "x", phase: "verify" }),
      "{not valid json",
      JSON.stringify({ ltf_version: "1.0", loop_id: "x", phase: "verify" }),
      "also not json",
    ].join("\n");
    writeFileSync(join(dir, ".loop/trace.ltf.jsonl"), content);

    const { records, malformedCount } = readTraces(dir);
    expect(records).toHaveLength(2);
    expect(malformedCount).toBe(2);
  });

  it("correctly sums nested tokens object (input+output), not a bare number", () => {
    const lines = [
      JSON.stringify({ phase: "act", tokens: { input: 100, output: 50 } }),
      JSON.stringify({ phase: "act", tokens: { input: 200, output: 25 } }),
    ];
    writeFileSync(join(dir, ".loop/trace.ltf.jsonl"), lines.join("\n") + "\n");

    const { records } = readTraces(dir);
    const total = records.reduce((sum: number, r) => {
      const e = r as { tokens?: { input?: number; output?: number } };
      return sum + (e.tokens?.input ?? 0) + (e.tokens?.output ?? 0);
    }, 0);
    expect(total).toBe(375);
  });

  it("skips blank lines without counting them as malformed", () => {
    const content = `${JSON.stringify({ phase: "verify" })}\n\n\n${JSON.stringify({ phase: "verify" })}\n`;
    writeFileSync(join(dir, ".loop/trace.ltf.jsonl"), content);

    const { records, malformedCount } = readTraces(dir);
    expect(records).toHaveLength(2);
    expect(malformedCount).toBe(0);
  });
});
