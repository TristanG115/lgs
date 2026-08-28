export const EXECUTION_MODES = ['normal', 'plan', 'web', 'research'] as const;
export type ExecutionMode = typeof EXECUTION_MODES[number];

export type ExecutionCapability = 'inspect' | 'plan' | 'edit' | 'commands' | 'web' | 'verify' | 'iterate';
export type ExecutionModePolicy = {
  id: ExecutionMode;
  label: string;
  capabilities: readonly ExecutionCapability[];
  requiresGoal: boolean;
  planBeforeMutation: boolean;
};

export type RequestStatus = 'active' | 'completed' | 'failed' | 'stopped' | 'waiting-for-user';
export type PhaseStatus = 'pending' | 'active' | 'completed' | 'blocked' | 'failed' | 'skipped';
export type ActivityEventType = 'request' | 'phase' | 'file' | 'search' | 'command' | 'browser' | 'provider' | 'test' | 'error' | 'warning' | 'tool' | 'verification';
export type ActivityStatus = 'started' | 'success' | 'failed' | 'info' | 'blocked';

export type WorkPhase = {
  id: string;
  name: string;
  goal: string;
  profileId: string;
  startedAt?: string;
  endedAt?: string;
  status: PhaseStatus;
  result?: string;
};

export type ActivityEvent = {
  id: string;
  requestId: string;
  phaseId?: string;
  timestamp: string;
  type: ActivityEventType;
  summary: string;
  detail?: string;
  status?: ActivityStatus;
  resource?: { kind: 'file' | 'url' | 'command' | 'provider'; value: string; line?: number };
  metadata?: Record<string, string | number | boolean>;
};

export type RequestExecution = {
  id: string;
  objective: string;
  mode: ExecutionMode;
  status: RequestStatus;
  startedAt: string;
  endedAt?: string;
  phases: WorkPhase[];
};

export type ContextCategory = 'conversation' | 'repository' | 'attachments' | 'skills' | 'instructions' | 'runtime';
export type ContextUsage = {
  used?: number;
  maximum?: number;
  unit: 'tokens';
  estimated: boolean;
  categories?: Partial<Record<ContextCategory, number>>;
  reason?: string;
};
