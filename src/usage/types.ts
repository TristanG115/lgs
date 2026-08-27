export type UsageBillingKind = 'commercial' | 'institution_provided' | 'local' | 'unknown';

export type ContextBreakdown = Partial<Record<'objective' | 'codebaseMap' | 'source' | 'git' | 'research' | 'memory' | 'tools' | 'conversation' | 'reserve', number>>;

export type ContextSavings = {
  rawCandidateTokens?: number;
  selectedTokens?: number;
  tokensAvoided?: number;
  reductionPercent?: number;
};

/** Metrics only. Prompt, source, tool, and completion contents are deliberately never stored here. */
export type UsageRecord = {
  id: string;
  timestamp: string;
  workspace?: string;
  providerConnection?: string;
  model?: string;
  agent?: string;
  role?: string;
  task?: string;
  session?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  contextMaximum?: number;
  contextUtilized?: number;
  contextBreakdown?: ContextBreakdown;
  contextSavings?: ContextSavings;
  promptProcessingMs?: number;
  generationMs?: number;
  tokensPerSecond?: number;
  latencyMs?: number;
  providerReportedCostUsd?: number;
  estimatedCostUsd?: number;
  billing: UsageBillingKind;
  /** Present only when the normalized provider stream reported a terminal outcome. */
  result?: 'success' | 'failed' | 'cancelled';
};

export type PricingEntry = {
  billing: UsageBillingKind;
  inputPerMillionUsd?: number;
  cachedInputPerMillionUsd?: number;
  outputPerMillionUsd?: number;
};

export type UsageBudgets = {
  maxCloudSpendPerTask?: number;
  maxCloudSpendPerPeriod?: number;
  periodDays: number;
  warnAtPercent: number;
  askBeforeCloudEscalation: boolean;
  contextUtilizationTarget?: number;
};

export type UsageConfiguration = {
  retentionDays: number;
  maxRecords: number;
  budgets: UsageBudgets;
};

export type UsageGroup = 'request' | 'agent' | 'task' | 'session' | 'model' | 'provider' | 'workspace' | 'period';
export type UsageAggregate = {
  key: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  contextUtilized: number;
  contextAvoided: number;
  providerReportedCostUsd: number;
  estimatedCostUsd: number;
  totalLatencyMs: number;
  totalGenerationMs: number;
  cloudEscalations: number;
};

export type UsageDashboard = {
  records: UsageRecord[];
  aggregates: Record<UsageGroup, UsageAggregate[]>;
  totals: UsageAggregate;
  budget: { taskSpendUsd?: number; periodSpendUsd?: number; warnings: string[] };
};
