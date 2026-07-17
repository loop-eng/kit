export { detect, detectTestRunner, detectAgent, detectAll } from "./detectors/index.js";
export { detectVerification } from "./detectors/verification.js";
export type {
  ProjectStack,
  TestRunner,
  AgentType,
  DetectionResult,
  WizardAnswers,
  BudgetConfig,
  Template,
} from "./types.js";
export type { VerificationInfo } from "./detectors/verification.js";
