import type { CompletionEvaluation } from '../completion/types.js';
import type { ConfiguredAgentModel } from '../orchestration/types.js';

export const WATCHDOG_CLASSIFICATIONS = [
  'ON_TRACK', 'OFF_TRACK', 'MISSING_REQUIREMENT', 'NEEDS_RESEARCH',
  'RECONSIDER_APPROACH', 'POTENTIAL_SCOPE_CREEP'
] as const;
export type WatchdogClassification = typeof WATCHDOG_CLASSIFICATIONS[number];

export type TaskState = {
  taskId: string;
  objective: string;
  acceptanceCriteria: string[];
  currentPlan: string[];
  completedWork: string[];
  remainingWork: string[];
  recentModifications: string[];
  verifiedFacts: string[];
  designDecisions: string[];
  failedApproaches: string[];
  blockers: string[];
  commitSha?: string;
  explicitUncertainty?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type WatchdogInput = {
  objective: string;
  acceptanceCriteria: string[];
  currentPlan: string[];
  completedWork: string[];
  remainingWork: string[];
  recentModifications: string[];
  recentFailures: string[];
  explicitUncertainty?: string;
  stalled: boolean;
};

export type WatchdogFinding = {
  classification: WatchdogClassification;
  evidence: string[];
  explanation: string;
  recommendedNextAction: string;
};

export type WatchdogEvaluation = WatchdogFinding & {
  taskId: string;
  evaluatedAt: string;
  stateRevision: number;
};

export interface WatchdogAnalyzer {
  analyze(input: WatchdogInput, signal?: AbortSignal): Promise<WatchdogFinding>;
}

export const ESCALATION_LEVELS = ['worker', 'manager', 'difficult', 'cloud'] as const;
export type EscalationLevel = typeof ESCALATION_LEVELS[number];
export const ESCALATION_TRIGGERS = [
  'repeated_failure', 'retry_exhaustion', 'reviewer_rejection', 'invalid_tool_request',
  'unresolved_criteria', 'explicit_uncertainty', 'watchdog_recommendation'
] as const;
export type EscalationTrigger = typeof ESCALATION_TRIGGERS[number];

export type WatchdogConfiguration = {
  intervalTurns: number;
  model?: ConfiguredAgentModel;
  escalationRoutes: Partial<Record<EscalationLevel, ConfiguredAgentModel>>;
};

export type EscalationRecord = {
  id: string;
  taskId: string;
  trigger: EscalationTrigger;
  reason: string;
  from: { level: EscalationLevel; profileId: string; model: string };
  to?: { level: EscalationLevel; profileId: string; model: string };
  taskStateRevision: number;
  createdAt: string;
};

export type ContinuationContext = {
  completion?: CompletionEvaluation;
  watchdog?: WatchdogFinding;
  failedVerification?: string[];
};
