export const RESEARCH_OPERATIONS = ['web_search', 'web_fetch', 'documentation_search', 'repository_search'] as const;
export type ResearchOperation = typeof RESEARCH_OPERATIONS[number];

export const SOURCE_AUTHORITIES = [
  'official-documentation', 'official-source', 'official-maintainer-discussion',
  'authoritative-reference', 'community', 'forum'
] as const;
export type SourceAuthority = typeof SOURCE_AUTHORITIES[number];

export type DependencyVersion = {
  name: string;
  declaredVersion?: string;
  resolvedVersion?: string;
  manifestPaths: string[];
};

export type ResearchSource = {
  url: string;
  title: string;
  snippet?: string;
  content?: string;
  authority: SourceAuthority;
  relevantVersion?: string;
};

export type ResearchFinding = {
  id: string;
  operation: ResearchOperation;
  sourceUrl: string;
  title: string;
  retrievedAt: string;
  relevantVersion?: string;
  finding: string;
  authority: SourceAuthority;
  priority: number;
  task: string;
  subtask?: string;
  requestingAgent: string;
  query: string;
  queryKey: string;
  dependency?: DependencyVersion;
};

export type ResearchRequest = {
  operation: ResearchOperation;
  query: string;
  url?: string;
  purpose?: string;
  taskId: string;
  requestingAgent: string;
  subtask?: string;
  dependency?: string;
  relevantVersion?: string;
  maxAgeDays?: number;
  signal?: AbortSignal;
};

export type ResearchResult = {
  operation: ResearchOperation;
  originalQuery: string;
  researchedQuery: string;
  dependency?: DependencyVersion;
  findings: ResearchFinding[];
  reused: boolean;
};

export interface ResearchProvider {
  readonly id: string;
  webSearch?(query: string, signal?: AbortSignal): Promise<ResearchSource[]>;
  webFetch?(url: string, signal?: AbortSignal): Promise<ResearchSource>;
  documentationSearch?(query: string, signal?: AbortSignal): Promise<ResearchSource[]>;
  repositorySearch?(query: string, signal?: AbortSignal): Promise<ResearchSource[]>;
}

export type ResearchConfiguration = {
  freshnessDays: number;
  maxResults: number;
  maxFetchBytes: number;
  endpoints: Partial<Record<'webSearch' | 'documentationSearch' | 'repositorySearch', string>>;
  github: { enabled: boolean; apiBaseUrl: string };
  autoResearch: AutoResearchMode;
  webEnabled: boolean;
  budgets: ResearchBudgets;
};

export const AUTO_RESEARCH_MODES = ['off', 'when-uncertain', 'proactive'] as const;
export type AutoResearchMode = typeof AUTO_RESEARCH_MODES[number];
export const EVIDENCE_STATES = ['CONFIRMED', 'STRONG', 'WEAK', 'HYPOTHESIS', 'REJECTED'] as const;
export type EvidenceState = typeof EVIDENCE_STATES[number];
export const RESEARCH_CONCLUSIONS = ['SUPPORTED', 'REJECTED', 'PARTIAL', 'INCONCLUSIVE'] as const;
export type ResearchConclusion = typeof RESEARCH_CONCLUSIONS[number];
export type EvidenceRecord = { id: string; claim: string; state: EvidenceState; provenance: string[]; recordedAt: string };
export type ResearchExperiment = {
  id: string; sequence: number; hypothesis: string; proposedExperiment: string; expectedObservation: string;
  actualObservation?: string; analysis?: string; conclusion?: ResearchConclusion; learned?: string; evidence: string[];
  status: 'proposed' | 'completed'; createdAt: string; completedAt?: string; repetitionJustification?: string;
};
export type ResearchCycle = {
  id: string; sequence: number; researchQuestion: string; currentEvidence: EvidenceRecord[]; hypothesis: string; confidence: number;
  experiment: ResearchExperiment; conclusion?: ResearchConclusion; nextAction: string; status: 'active' | 'completed'; createdAt: string; completedAt?: string;
};
export type ResearchNotebook = {
  taskId: string; researchQuestion: string; establishedFacts: EvidenceRecord[]; uncertainClaims: EvidenceRecord[]; currentHypotheses: string[];
  importantSources: string[]; experiments: ResearchExperiment[]; rejectedApproaches: string[]; currentBestExplanation: string;
  remainingUnknowns: string[]; currentRecommendation: string; cycles: ResearchCycle[]; status: 'active' | 'paused' | 'completed'; pauseReason?: string;
  createdAt: string; updatedAt: string;
};
export type ResearchBudgets = { maximumCycles: number; maximumConsecutiveFailedCycles: number; wallClockMinutes: number; maximumTokens?: number; maximumCostUsd?: number; minimumProgressCycles: number };
export type ResearchTrigger = 'explicit-request' | 'explicit-uncertainty' | 'unfamiliar-behavior' | 'version-sensitive-assumption' | 'unsupported-external-assumption' | 'watchdog-needs-research' | 'proactive-decision';
export type ResearchRequirement = { id: string; trigger: ResearchTrigger; reason: string; createdAt: string; satisfiedAt?: string; evidenceIds: string[] };
