import { detect } from "./stack.js";
import { detectTestRunner } from "./test-runner.js";
import { detectAgent } from "./agent.js";
import { detectVerification } from "./verification.js";
import type { DetectionResult } from "../types.js";

export { detect, detectTestRunner, detectAgent, detectVerification };

export function detectAll(dir: string): DetectionResult {
  const stack = detect(dir);
  const testRunner = detectTestRunner(dir);
  const agents = detectAgent(dir);
  const verification = detectVerification(dir, stack, testRunner);

  return {
    stack,
    testRunner,
    agents,
    verificationCommand: verification.testCommand,
  };
}
