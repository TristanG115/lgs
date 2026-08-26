import type { ExecutionResult } from '../execution/types.js';
import type { DocumentationAuditReader } from '../documentation/types.js';

export const COMPLETION_REQUIREMENTS = [
  'acceptance_criteria_addressed', 'implementation_complete', 'relevant_tests_added_or_updated',
  'targeted_tests_pass', 'full_tests_pass', 'typecheck_passes', 'lint_passes', 'build_succeeds',
  'documentation_current', 'codebase_map_current', 'runtime_verification_passes',
  'independent_review_passes', 'no_unresolved_task_failures'
] as const;

export type CompletionRequirement = typeof COMPLETION_REQUIREMENTS[number];
export type CompletionStatus = 'passed' | 'blocked';
export type CompletionEvidenceSource = 'task-record' | 'execution' | 'repository-intelligence' | 'documentation-audit';

export type CompletionEvidence = {
  id: string;
  requirement: CompletionRequirement;
  summary: string;
  recordedAt: string;
  source: CompletionEvidenceSource;
  files?: { path: string; hash: string }[];
  executionId?: string;
  documentationAuditId?: string;
};

export type CompletionChecklistItem = {
  requirement: CompletionRequirement;
  label: string;
  required: boolean;
  passed: boolean;
  detail: string;
  evidence: CompletionEvidence[];
};

export type FailureBudgetConfiguration = {
  same_error_retry_limit: number;
  total_fix_attempt_limit: number;
  escalation_threshold: number;
};

export type CompletionGateConfiguration = Record<CompletionRequirement, boolean>;
export type CompletionConfiguration = {
  gates: CompletionGateConfiguration;
  failureBudgets: FailureBudgetConfiguration;
};

export type FailureBudgetState = {
  totalFailures: number;
  largestSameErrorCount: number;
  dominantError?: string;
  exhausted: boolean;
  escalationRequired: boolean;
  reason?: string;
};

export type CompletionEvaluation = {
  taskId: string;
  status: CompletionStatus;
  progress: { passed: number; required: number };
  checklist: CompletionChecklistItem[];
  outstanding: string[];
  failureBudget: FailureBudgetState;
  attemptedAt: string;
};

export type CompletionViewState = CompletionEvaluation;

export interface ExecutionEvidenceReader {
  read(taskId: string): { recordedAt: string; execution: ExecutionResult }[];
}

export interface EscalationEvidenceReader {
  read(taskId: string): { createdAt: string; to?: unknown }[];
}

export type { DocumentationAuditReader };
