import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { generateHooks } from "../hooks.js";

describe("generateHooks", () => {
  it("generates valid bash with shebang", () => {
    const result = generateHooks("npm test");
    expect(result).toContain("#!/usr/bin/env bash");
    expect(result).toContain("npm test");
  });

  it("escapes single quotes in verify command", () => {
    const result = generateHooks("echo 'hello world'");
    expect(result).toContain("echo '\\''hello world'\\''");
    expect(result).not.toContain("echo 'Running verification: echo 'hello");
  });

  it("handles commands without single quotes", () => {
    const result = generateHooks("npm test");
    expect(result).toContain("Running verification: npm test");
  });

  it("preserves the actual command unescaped for execution, wrapped in a subshell", () => {
    const result = generateHooks("echo 'test'");
    const lines = result.split("\n");
    const execLine = lines.find((l) => l.trim() === "( echo 'test' )");
    expect(execLine).toBeTruthy();
  });

  it("wraps the verify command in a subshell so an internal `exit` doesn't kill the whole script", () => {
    const result = generateHooks("exit 1");
    const lines = result.split("\n");
    const execLine = lines.find((l) => l.trim() === "( exit 1 )");
    expect(execLine).toBeTruthy();
  });

  it("captures exit code correctly", () => {
    const result = generateHooks("npm test");
    expect(result).toContain("set +e");
    expect(result).toContain("exit_code=$?");
    expect(result).toContain("set -e");
  });

  it("embeds LTF trace-emission logic", () => {
    const result = generateHooks("npm test");
    expect(result).toContain("trace.ltf.jsonl");
    expect(result).toContain("loop_summary");
    expect(result).toContain("ltf_version");
  });
});

describe("generateHooks — real execution (LTF trace emission)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kit-hooks-exec-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeAndRunHook(verifyCommand: string): { exitCode: number | null; stdout: string } {
    const script = generateHooks(verifyCommand);
    const scriptPath = join(dir, "verify.sh");
    writeFileSync(scriptPath, script, "utf-8");
    chmodSync(scriptPath, 0o755);
    const result = spawnSync("bash", [scriptPath], { cwd: dir, encoding: "utf-8" });
    return { exitCode: result.status, stdout: result.stdout };
  }

  function readTraceLines(): unknown[] {
    const content = readFileSync(join(dir, "trace.ltf.jsonl"), "utf-8");
    return content
      .trim()
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  }

  it("appends a single valid JSON line per passing verification, plus terminate + loop_summary", () => {
    const { exitCode } = writeAndRunHook("exit 0");
    expect(exitCode).toBe(0);

    const records = readTraceLines() as Array<Record<string, unknown>>;
    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({ phase: "verify", iteration: 1, result: { status: "success" } });
    expect(records[1]).toMatchObject({ phase: "terminate" });
    expect(records[2]).toMatchObject({ type: "loop_summary", termination_reason: "goal_met", total_iterations: 1 });
  });

  it("appends only a verify-phase fail line on failed verification — no terminate/summary", () => {
    const { exitCode } = writeAndRunHook("exit 1");
    expect(exitCode).toBe(1);

    const records = readTraceLines() as Array<Record<string, unknown>>;
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      phase: "verify",
      iteration: 1,
      result: { status: "fail" },
      verification: { exit_code: 1 },
    });
  });

  it("every phase-event line has ltf_version, loop_id, timestamp, phase (or type for summaries)", () => {
    writeAndRunHook("exit 0");
    const records = readTraceLines() as Array<Record<string, unknown>>;
    for (const r of records) {
      expect(r.ltf_version).toBe("1.0");
      expect(r.loop_id).toBeTruthy();
      if (r.type !== "loop_summary") {
        expect(r.timestamp).toBeTruthy();
        expect(["plan", "act", "verify", "decide", "error", "terminate"]).toContain(r.phase);
      } else {
        expect(r.phase).toBeUndefined();
      }
    }
  });

  it("preserves loop_id and increments iteration across repeated invocations", () => {
    writeAndRunHook("exit 1");
    writeAndRunHook("exit 1");
    writeAndRunHook("exit 0");

    const records = readTraceLines() as Array<Record<string, unknown>>;
    const loopIds = new Set(records.map((r) => r.loop_id));
    expect(loopIds.size).toBe(1);

    const verifyEvents = records.filter((r) => r.phase === "verify");
    expect(verifyEvents.map((r) => r.iteration)).toEqual([1, 2, 3]);

    const summary = records.find((r) => r.type === "loop_summary") as Record<string, unknown>;
    expect(summary.total_iterations).toBe(3);
  });

  it("emits loop_summary exactly once, even after multiple successful re-runs (regression)", () => {
    // A loop_summary is a one-time terminal record per SPEC.md. Re-running
    // verify.sh after the loop already succeeded once (e.g. a CI job that
    // re-verifies periodically) must not append additional summary/terminate
    // records for the same loop_id.
    writeAndRunHook("exit 0");
    writeAndRunHook("exit 0");
    writeAndRunHook("exit 0");

    const records = readTraceLines() as Array<Record<string, unknown>>;
    const verifyEvents = records.filter((r) => r.phase === "verify");
    const terminateEvents = records.filter((r) => r.phase === "terminate");
    const summaries = records.filter((r) => r.type === "loop_summary");

    expect(verifyEvents).toHaveLength(3);
    expect(terminateEvents).toHaveLength(1);
    expect(summaries).toHaveLength(1);
    expect((summaries[0] as { total_iterations: number }).total_iterations).toBe(1);
  });

  it("never overwrites prior lines — file only grows across invocations", () => {
    writeAndRunHook("exit 1");
    const afterFirst = readFileSync(join(dir, "trace.ltf.jsonl"), "utf-8");
    writeAndRunHook("exit 1");
    const afterSecond = readFileSync(join(dir, "trace.ltf.jsonl"), "utf-8");

    expect(afterSecond.startsWith(afterFirst)).toBe(true);
    expect(afterSecond.length).toBeGreaterThan(afterFirst.length);
  });

  it("produces one JSON object per line — no pretty-printing, no multi-line records", () => {
    writeAndRunHook("exit 0");
    const raw = readFileSync(join(dir, "trace.ltf.jsonl"), "utf-8");
    const lines = raw.trim().split("\n");
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    expect(lines).toHaveLength(3);
  });

  it("handles a verify command containing single quotes, double quotes, and a literal percent sign", () => {
    const weirdCommand = `printf '%s' "it's a test" && exit 0`;
    const { exitCode } = writeAndRunHook(weirdCommand);
    expect(exitCode).toBe(0);

    const records = readTraceLines() as Array<Record<string, unknown>>;
    const verifyEvent = records[0] as { verification: { command: string } };
    expect(verifyEvent.verification.command).toBe(weirdCommand);
  });

  it("never blocks verification exit code even though tracing runs after", () => {
    const { exitCode } = writeAndRunHook("exit 42");
    expect(exitCode).toBe(42);
  });
});
