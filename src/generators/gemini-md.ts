export function generateGeminiMd(
  task: string,
  verifyCommand: string,
  templateInstructions?: string | null,
): string {
  const extra = templateInstructions ? `\n${templateInstructions.trim()}\n` : "";
  return `# Gemini Instructions

## Goal
${task}

## Verification
Run this command to verify progress:
\`\`\`bash
${verifyCommand}
\`\`\`

## Protocol
1. Read \`.loop/state.md\` to understand current state
2. Make targeted changes to address the goal
3. Run \`${verifyCommand}\` to verify
4. Update \`.loop/state.md\` with progress
5. Loop until verification passes
${extra}
## Constraints
- Fix root causes, not symptoms
- Do not delete tests to make them pass
- Do not modify the verification command
`;
}
