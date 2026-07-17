import type { DetectionResult } from "../types.js";
import type { VerificationInfo } from "../detectors/verification.js";

export function generateClaudeMd(
  task: string,
  verifyCommand: string,
  detection: DetectionResult,
  verification: VerificationInfo,
  templateInstructions?: string | null,
): string {
  const sections: string[] = [];

  sections.push(`# Loop Configuration

## Goal
${task}

## Verification Gate
Run this command to verify progress:
\`\`\`bash
${verifyCommand}
\`\`\`

The loop is complete when this command exits with code 0.`);

  sections.push(`## Loop Protocol
1. Understand the current state by reading \`.loop/state.md\`
2. Make targeted changes to address the goal
3. Run the verification command: \`${verifyCommand}\`
4. Update \`.loop/state.md\` with progress
5. If verification passes, the loop is complete
6. If verification fails, analyze the output and iterate`);

  if (verification.buildCommand || verification.lintCommand) {
    const checks: string[] = [];
    if (verification.buildCommand) checks.push(`- Build: \`${verification.buildCommand}\``);
    if (verification.lintCommand) checks.push(`- Lint: \`${verification.lintCommand}\``);
    if (verification.testCommand) checks.push(`- Test: \`${verification.testCommand}\``);

    sections.push(`## Additional Checks
${checks.join("\n")}`);
  }

  sections.push(`## Project Context
- Stack: ${detection.stack}
- Test runner: ${detection.testRunner}
- Verification: ${verifyCommand}`);

  if (templateInstructions) {
    sections.push(templateInstructions.trim());
  }

  sections.push(`## Constraints
- Do not suppress errors with \`@ts-ignore\`, \`any\`, or \`# type: ignore\` — fix the root cause
- Do not delete tests to make them pass
- Do not modify the verification command
- Update \`.loop/state.md\` after each iteration`);

  return sections.join("\n\n") + "\n";
}
