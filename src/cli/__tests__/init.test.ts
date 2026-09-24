import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// @clack/prompts' real isCancel checks strict identity against a
// module-private `Symbol("clack:cancel")` that is never exported, so a
// test can't fabricate the exact value clack itself would produce on a
// real Ctrl+C. Instead we mock isCancel and the prompt functions together
// against a single local sentinel. This verifies the thing that actually
// matters for this suite — that init.ts calls isCancel after every prompt
// and branches correctly — without claiming to exercise clack's real
// internal cancellation plumbing (that would require PTY-level terminal
// emulation, which both planning passes for this phase rejected as
// disproportionately flaky for this project's size).
const CANCEL = Symbol("test-cancel");

vi.mock("@clack/prompts", () => ({
  text: vi.fn(),
  select: vi.fn(),
  isCancel: (value: unknown) => value === CANCEL,
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  cancel: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
}));

const commandExistsMock = vi.fn();
vi.mock("../../detectors/agent.js", () => ({
  commandExists: (...args: unknown[]) => commandExistsMock(...args),
}));

import * as p from "@clack/prompts";
import {
  runWizard,
  budgetTierFromUsd,
  parseAgentFlag,
  warnIfBashUnavailable,
  buildDefaults,
  defaultAgents,
  exitOnInvalidDir,
  exitOnInvalidAgentFlag,
  exitOnTemplateNotFound,
  exitOnWizardCancel,
} from "../init.js";
import type { DetectionResult, WizardAnswers } from "../../types.js";

const text = vi.mocked(p.text);
const select = vi.mocked(p.select);

const detection: DetectionResult = {
  stack: "typescript",
  testRunner: "vitest",
  agents: ["claude-code"],
  verificationCommand: "npx vitest run",
};

describe("runWizard — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("assembles WizardAnswers from the full prompt sequence", async () => {
    text.mockResolvedValueOnce("Fix all bugs"); // task
    select.mockResolvedValueOnce("test-suite"); // verification
    select.mockResolvedValueOnce("standard"); // budget
    select.mockResolvedValueOnce("claude-code"); // agent
    select.mockResolvedValueOnce("standard"); // iterations

    const result = await runWizard(detection, "npx vitest run", null);

    expect(result).toEqual({
      task: "Fix all bugs",
      verification: "test-suite",
      customCommand: undefined,
      budget: "standard",
      agents: ["claude-code"],
      iterations: 10,
    });
  });

  it("expands 'all' agent choice to all four agent types", async () => {
    text.mockResolvedValueOnce("Fix all bugs");
    select.mockResolvedValueOnce("test-suite");
    select.mockResolvedValueOnce("standard");
    select.mockResolvedValueOnce("all"); // agent choice
    select.mockResolvedValueOnce("standard");

    const result = await runWizard(detection, "npx vitest run", null);

    expect(result?.agents).toEqual(["claude-code", "codex", "gemini", "cursor"]);
  });

  it("skips the agent prompt entirely when an agent override is provided", async () => {
    text.mockResolvedValueOnce("Fix all bugs");
    select.mockResolvedValueOnce("test-suite");
    select.mockResolvedValueOnce("standard");
    select.mockResolvedValueOnce("standard"); // iterations — agent select skipped

    const result = await runWizard(detection, "npx vitest run", ["codex", "gemini"]);

    expect(result?.agents).toEqual(["codex", "gemini"]);
    // Only 3 select() calls: verification, budget, iterations — no agent select.
    expect(select).toHaveBeenCalledTimes(3);
  });

  it("prompts for a custom command only when verification is 'custom'", async () => {
    text.mockResolvedValueOnce("Fix all bugs"); // task
    select.mockResolvedValueOnce("custom"); // verification
    text.mockResolvedValueOnce("npm run my-check"); // custom command follow-up
    select.mockResolvedValueOnce("standard"); // budget
    select.mockResolvedValueOnce("claude-code"); // agent
    select.mockResolvedValueOnce("standard"); // iterations

    const result = await runWizard(detection, "npx vitest run", null);

    expect(result?.verification).toBe("custom");
    expect(result?.customCommand).toBe("npm run my-check");
    expect(text).toHaveBeenCalledTimes(2);
  });

  it("does not prompt for a custom command when verification is not 'custom'", async () => {
    text.mockResolvedValueOnce("Fix all bugs");
    select.mockResolvedValueOnce("test-suite");
    select.mockResolvedValueOnce("standard");
    select.mockResolvedValueOnce("claude-code");
    select.mockResolvedValueOnce("standard");

    const result = await runWizard(detection, "npx vitest run", null);

    expect(result?.customCommand).toBeUndefined();
    expect(text).toHaveBeenCalledTimes(1);
  });

  it("falls back to 10 iterations for an unrecognized iteration choice", async () => {
    text.mockResolvedValueOnce("Fix all bugs");
    select.mockResolvedValueOnce("test-suite");
    select.mockResolvedValueOnce("standard");
    select.mockResolvedValueOnce("claude-code");
    select.mockResolvedValueOnce("some-unmapped-value");

    const result = await runWizard(detection, "npx vitest run", null);

    expect(result?.iterations).toBe(10);
  });
});

describe("runWizard — cancellation at every step (returns null; see exitOnWizardCancel below for the actual exit-code regression test)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when the task prompt is cancelled", async () => {
    text.mockResolvedValueOnce(CANCEL);
    const result = await runWizard(detection, "npx vitest run", null);
    expect(result).toBeNull();
  });

  it("wires a task-prompt validator that rejects blank/whitespace-only input", async () => {
    // The `validate` callback is passed to p.text; since p.text is mocked,
    // we can't exercise Clack's own re-prompt loop — this test only
    // confirms init.ts WIRES a validator with the right behavior, not that
    // runWizard() itself re-prompts or returns null for empty input (it
    // doesn't need to — that's Clack's own re-prompt loop, out of scope
    // here per this phase's scope boundary).
    text.mockResolvedValueOnce("real task");
    select.mockResolvedValueOnce("test-suite");
    select.mockResolvedValueOnce("standard");
    select.mockResolvedValueOnce("claude-code");
    select.mockResolvedValueOnce("standard");

    await runWizard(detection, "npx vitest run", null);

    const taskCallArgs = text.mock.calls[0][0] as { validate?: (v: string) => string | undefined };
    expect(taskCallArgs.validate?.("")).toBe("Task is required");
    expect(taskCallArgs.validate?.("  ")).toBe("Task is required");
    expect(taskCallArgs.validate?.("valid")).toBeUndefined();
  });

  it("returns null when the verification-method prompt is cancelled", async () => {
    text.mockResolvedValueOnce("task");
    select.mockResolvedValueOnce(CANCEL);
    const result = await runWizard(detection, "npx vitest run", null);
    expect(result).toBeNull();
  });

  it("returns null when the custom-command follow-up prompt is cancelled", async () => {
    text.mockResolvedValueOnce("task");
    select.mockResolvedValueOnce("custom");
    text.mockResolvedValueOnce(CANCEL);
    const result = await runWizard(detection, "npx vitest run", null);
    expect(result).toBeNull();
  });

  it("rejects an empty custom command (regression: FINDINGS #12)", async () => {
    text.mockResolvedValueOnce("task");
    select.mockResolvedValueOnce("custom");
    text.mockResolvedValueOnce("npm test");
    select.mockResolvedValueOnce("standard");
    select.mockResolvedValueOnce("claude-code");
    select.mockResolvedValueOnce("standard");

    await runWizard(detection, "npx vitest run", null);

    const customCmdCallArgs = text.mock.calls[1][0] as { validate?: (v: string) => string | undefined };
    expect(customCmdCallArgs.validate?.("")).toBe("Command is required");
    expect(customCmdCallArgs.validate?.("npm test")).toBeUndefined();
  });

  it("returns null when the budget prompt is cancelled", async () => {
    text.mockResolvedValueOnce("task");
    select.mockResolvedValueOnce("test-suite");
    select.mockResolvedValueOnce(CANCEL);
    const result = await runWizard(detection, "npx vitest run", null);
    expect(result).toBeNull();
  });

  it("returns null when the agent prompt is cancelled", async () => {
    text.mockResolvedValueOnce("task");
    select.mockResolvedValueOnce("test-suite");
    select.mockResolvedValueOnce("standard");
    select.mockResolvedValueOnce(CANCEL);
    const result = await runWizard(detection, "npx vitest run", null);
    expect(result).toBeNull();
  });

  it("returns null when the iteration prompt is cancelled", async () => {
    text.mockResolvedValueOnce("task");
    select.mockResolvedValueOnce("test-suite");
    select.mockResolvedValueOnce("standard");
    select.mockResolvedValueOnce("claude-code");
    select.mockResolvedValueOnce(CANCEL);
    const result = await runWizard(detection, "npx vitest run", null);
    expect(result).toBeNull();
  });
});

describe("budgetTierFromUsd", () => {
  it("maps USD amounts to the correct tier boundaries", () => {
    expect(budgetTierFromUsd(5)).toBe("quick");
    expect(budgetTierFromUsd(20)).toBe("standard");
    expect(budgetTierFromUsd(50)).toBe("thorough");
    expect(budgetTierFromUsd(51)).toBe("unlimited");
    expect(budgetTierFromUsd(0)).toBe("quick");
  });
});

describe("parseAgentFlag", () => {
  it("expands 'all' to all four agents", () => {
    expect(parseAgentFlag("all")).toEqual(["claude-code", "codex", "gemini", "cursor"]);
  });

  it("parses a single agent", () => {
    expect(parseAgentFlag("codex")).toEqual(["codex"]);
  });

  it("parses comma-separated agents, trimming whitespace and lowercasing", () => {
    expect(parseAgentFlag(" Claude-Code , GEMINI ")).toEqual(["claude-code", "gemini"]);
  });

  it("deduplicates repeated agents", () => {
    expect(parseAgentFlag("codex,codex,gemini")).toEqual(["codex", "gemini"]);
  });

  it("normalizes output to canonical order regardless of input order", () => {
    expect(parseAgentFlag("gemini,codex")).toEqual(["codex", "gemini"]);
    expect(parseAgentFlag("cursor,claude-code")).toEqual(["claude-code", "cursor"]);
    expect(parseAgentFlag("cursor,gemini,claude-code,codex")).toEqual([
      "claude-code",
      "codex",
      "gemini",
      "cursor",
    ]);
  });

  it("returns null for an unrecognized agent name", () => {
    expect(parseAgentFlag("bogus")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseAgentFlag("")).toBeNull();
    expect(parseAgentFlag("  ")).toBeNull();
  });

  it("returns null if any single item in a comma-separated list is invalid", () => {
    expect(parseAgentFlag("codex,bogus")).toBeNull();
  });
});

describe("warnIfBashUnavailable", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    commandExistsMock.mockReset();
  });

  it("is a no-op on non-Windows platforms (doesn't call p.note)", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    const noteSpy = vi.mocked(p.note);
    noteSpy.mockClear();

    warnIfBashUnavailable();

    expect(noteSpy).not.toHaveBeenCalled();
    expect(commandExistsMock).not.toHaveBeenCalled();
  });

  it("warns when on win32 and bash is not on PATH", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    commandExistsMock.mockReturnValue(false);
    const noteSpy = vi.mocked(p.note);
    noteSpy.mockClear();

    warnIfBashUnavailable();

    expect(commandExistsMock).toHaveBeenCalledWith("bash");
    expect(noteSpy).toHaveBeenCalledTimes(1);
    expect(noteSpy.mock.calls[0][0]).toContain("bash");
  });

  it("does not warn when on win32 and bash IS on PATH", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    commandExistsMock.mockReturnValue(true);
    const noteSpy = vi.mocked(p.note);
    noteSpy.mockClear();

    warnIfBashUnavailable();

    expect(commandExistsMock).toHaveBeenCalledWith("bash");
    expect(noteSpy).not.toHaveBeenCalled();
  });
});

describe("exit helpers (regression: FINDINGS #25 — exit 130 on cancel, not 0)", () => {
  // process.exit is typed `never`, so calling the real one would kill the
  // test worker. Mocking it as a thrown sentinel lets us assert it was
  // called with the right code AND stop execution the same way the real
  // one would, without actually exiting.
  let exitSpy: any;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    vi.mocked(p.cancel).mockClear();
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it("exitOnWizardCancel calls process.exit(130) when answers is null", () => {
    expect(() => exitOnWizardCancel(null)).toThrow("process.exit(130)");
    expect(exitSpy).toHaveBeenCalledWith(130);
    expect(p.cancel).toHaveBeenCalledWith("Setup cancelled.");
  });

  it("exitOnWizardCancel does NOT call process.exit when answers is present", () => {
    const answers: WizardAnswers = {
      task: "t",
      verification: "test-suite",
      budget: "standard",
      agents: ["claude-code"],
      iterations: 10,
    };
    expect(() => exitOnWizardCancel(answers)).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("exitOnInvalidDir calls process.exit(1)", () => {
    expect(() => exitOnInvalidDir("/some/file")).toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exitOnInvalidAgentFlag calls process.exit(1)", () => {
    expect(() => exitOnInvalidAgentFlag("bogus")).toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exitOnTemplateNotFound calls process.exit(1)", () => {
    expect(() => exitOnTemplateNotFound("nonexistent")).toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("defaultAgents", () => {
  it("uses the first detected agent when detection finds any", () => {
    const withDetected: DetectionResult = { ...detection, agents: ["gemini", "codex"] };
    expect(defaultAgents(withDetected)).toEqual(["gemini"]);
  });

  it("falls back to claude-code when nothing is detected", () => {
    const noneDetected: DetectionResult = { ...detection, agents: [] };
    expect(defaultAgents(noneDetected)).toEqual(["claude-code"]);
  });
});

describe("buildDefaults", () => {
  it("uses an explicit agent override when provided", () => {
    const result = buildDefaults(detection, ["codex", "gemini"]);
    expect(result.agents).toEqual(["codex", "gemini"]);
  });

  it("falls back to defaultAgents(detection) when no override is given", () => {
    const withDetected: DetectionResult = { ...detection, agents: ["gemini"] };
    const result = buildDefaults(withDetected, null);
    expect(result.agents).toEqual(["gemini"]);
  });

  it("always produces test-suite verification and standard budget/iterations", () => {
    const result = buildDefaults(detection, null);
    expect(result.verification).toBe("test-suite");
    expect(result.budget).toBe("standard");
    expect(result.iterations).toBe(10);
  });
});
