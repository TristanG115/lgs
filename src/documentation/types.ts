import type { TaskState } from '../watchdog/types.js';

export const DOCUMENTATION_CATEGORIES = [
  'user-facing', 'developer', 'architecture', 'configuration', 'api', 'inline-comments', 'codebase-map', 'task-records'
] as const;
export type DocumentationCategory = typeof DOCUMENTATION_CATEGORIES[number];
export type DocumentationStatus = 'current' | 'stale' | 'not-applicable';

export type ChangedSymbol = { path: string; symbols: string[] };
export type RepositoryRelationship = { from: string; to: string };
export type DocumentationSource = { path: string; excerpt: string };

export type DocumentationContext = {
  objective: string;
  acceptanceCriteria: string[];
  diff: string;
  changedPaths: string[];
  changedSymbols: ChangedSymbol[];
  repositoryRelationships: RepositoryRelationship[];
  currentDocumentation: DocumentationSource[];
  codebaseMap: string;
  taskState: TaskState;
  changeKinds: string[];
};

export type DocumentationAssessment = {
  category: DocumentationCategory;
  status: DocumentationStatus;
  reason: string;
  affectedFiles: string[];
};

export type DocumentationAnalysis = {
  summary: string;
  assessments: DocumentationAssessment[];
};

export type DocumentationAudit = DocumentationAnalysis & {
  id: string;
  taskId: string;
  contextFingerprint: string;
  taskStateRevision: number;
  changedPaths: string[];
  createdAt: string;
};

export interface DocumentationAnalyzer {
  analyze(context: DocumentationContext, signal?: AbortSignal): Promise<DocumentationAnalysis>;
}

export interface DocumentationAuditReader {
  read(taskId: string): DocumentationAudit | undefined;
  isCurrent(audit: DocumentationAudit): boolean;
}
