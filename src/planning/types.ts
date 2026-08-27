export const TASK_MODES = ['chat', 'plan', 'implement', 'research', 'review'] as const;
export type TaskMode = typeof TASK_MODES[number];

export type PlanHandoff = 'wait-for-approval' | 'implement-automatically';
export type PlanSection = {
  objective: string;
  acceptanceCriteria: string[];
  currentUnderstanding: string[];
  approach: string[];
  expectedAreas: string[];
  implementationStages: string[];
  verificationPlan: string[];
  risks: string[];
  openQuestions: string[];
};
export type PlanRevision = { revision: number; createdAt: string; changed: string; reason: string; evidence: string[] };
export type PlanningArtifact = PlanSection & {
  taskId: string;
  handoff: PlanHandoff;
  status: 'draft' | 'approved';
  revisions: PlanRevision[];
  createdAt: string;
  updatedAt: string;
};
