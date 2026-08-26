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
};
