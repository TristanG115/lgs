import type { DocumentationAssessment } from '../documentation/types.js';
import type { ResearchFinding } from '../research/types.js';

export const REVIEW_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type ReviewSeverity = typeof REVIEW_SEVERITIES[number];
export const REVIEW_CONFIDENCES = ['high', 'medium', 'low'] as const;
export type ReviewConfidence = typeof REVIEW_CONFIDENCES[number];

export type ReviewFinding = {
  id: string;
  severity: ReviewSeverity;
  confidence: ReviewConfidence;
  location: string;
  description: string;
  evidence: string;
  recommendedAction: string;
};

export type ReviewSource = { path: string; content: string };
export type ReviewVerification = { step?: string; command: string; status: string; completedAt: string; primaryError?: string };
export type ReviewDocumentation = { changedFiles: string[]; auditCurrent: boolean; assessments: DocumentationAssessment[] };
export type ReviewContext = {
  objective: string;
  acceptanceCriteria: string[];
  diff: string;
  relevantSource: ReviewSource[];
  tests: ReviewSource[];
  verificationResults: ReviewVerification[];
  researchFindings: ResearchFinding[];
  documentationChanges: ReviewDocumentation;
  preexistingUserChanges: { path: string; status: string; category: 'staged' | 'unstaged' | 'untracked' }[];
};

export type ReviewAnalysis = { summary: string; findings: ReviewFinding[] };
export type ReviewStatus = 'pending-manager-evaluation' | 'changes-requested' | 'approved';
export type FindingDisposition = { findingId: string; decision: 'confirmed' | 'dismissed'; rationale: string };
export type ReviewRecord = ReviewAnalysis & {
  id: string;
  taskId: string;
  iteration: number;
  contextFingerprint: string;
  status: ReviewStatus;
  createdAt: string;
  evaluatedAt?: string;
  dispositions?: FindingDisposition[];
};

export interface ReviewerAnalyzer { analyze(context: ReviewContext, signal?: AbortSignal): Promise<ReviewAnalysis>; }
export interface IndependentReviewReader {
  latest(taskId: string): ReviewRecord | undefined;
  isCurrent(review: ReviewRecord): boolean;
}
