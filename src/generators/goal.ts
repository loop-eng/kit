export function generateGoal(task: string, verifyCommand: string): string {
  return `# Goal

## Task
${task}

## Success Criteria
The verification command must exit with code 0:
\`\`\`bash
${verifyCommand}
\`\`\`

## Instructions
1. Analyze the current state of the project
2. Identify what needs to change to satisfy the goal
3. Make incremental changes — one logical step at a time
4. Run the verification command after each change
5. If verification fails, read the error output carefully and fix
6. Update \`.loop/state.md\` with your progress after each iteration
7. Stop when verification passes with exit code 0
`;
}
