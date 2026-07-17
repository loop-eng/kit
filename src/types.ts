export type ProjectStack =
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "rust"
  | "unknown";

export type TestRunner =
  | "vitest"
  | "jest"
  | "mocha"
  | "pytest"
  | "go-test"
  | "cargo-test"
  | "unknown";

export type AgentType = "claude-code" | "codex" | "gemini" | "cursor";

export type VerificationMethod =
  | "test-suite"
  | "build-passes"
  | "lint-clean"
  | "custom";

export type BudgetTier = "quick" | "standard" | "thorough" | "unlimited";

export interface WizardAnswers {
  task: string;
  verification: VerificationMethod;
  customCommand?: string;
  budget: BudgetTier;
  agent: AgentType;
  iterations: number;
}

export interface BudgetConfig {
  budget: {
    max_cost_usd: number | null;
    max_iterations: number | null;
    max_duration_minutes: number | null;
  };
  verification: {
    command: string;
    must_pass: boolean;
    retry_on_fail: boolean;
  };
  convergence: {
    stall_iterations: number;
    same_error_threshold: number;
  };
  ltf: {
    enabled: boolean;
    output: string;
  };
}

export interface Template {
  name: string;
  description: string;
  tags: string[];
  goal: string;
  verification: {
    command: string;
    description: string;
  };
  budget: {
    suggested_usd: number;
    suggested_iterations: number;
  };
  agent_instructions: Record<string, string>;
}

export interface DetectionResult {
  stack: ProjectStack;
  testRunner: TestRunner;
  agents: AgentType[];
  verificationCommand: string;
}
