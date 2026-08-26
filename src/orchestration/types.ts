import type { LgsMessage } from '../model/types.js';

export const AGENT_ROLES = [
  'manager', 'explorer', 'researcher', 'implementer', 'test-engineer',
  'documentation-agent', 'reviewer', 'debugger', 'verifier'
] as const;

export type AgentRole = typeof AGENT_ROLES[number];
export type AgentAccess = 'read-only' | 'write';
export type AgentState = 'created' | 'running' | 'completed' | 'failed' | 'cancelled' | 'destroyed';

export type AgentModelIdentity = {
  profileId: string;
  model: string;
};

export type ConfiguredAgentModel = {
  profileId?: string;
  model: string;
};

export type OrchestrationConfiguration = {
  roleModels: Partial<Record<AgentRole, ConfiguredAgentModel>>;
  readOnlyConcurrency: number;
  maxWorkersPerBatch: number;
  maxContextMessages: number;
};

export type WorkerReport = {
  findings: string[];
  relevantFiles: string[];
  workPerformed: string[];
  risks: string[];
  unresolvedQuestions: string[];
  recommendation: string;
};

export type AgentDescriptor = {
  id: string;
  role: AgentRole;
  access: AgentAccess;
  model: AgentModelIdentity;
  parentId?: string;
  state: AgentState;
  createdAt: string;
  updatedAt: string;
  report?: WorkerReport;
  error?: string;
};

export type CreateAgentRequest = {
  role: AgentRole;
  access?: AgentAccess;
  parentId?: string;
  initialContext?: LgsMessage[];
};

export type AgentSubtask = {
  objective: string;
  context?: LgsMessage[];
};

export type DelegatedSubtask = AgentSubtask & {
  role: Exclude<AgentRole, 'manager'>;
  access?: AgentAccess;
};

export type DelegatedResult = {
  agentId: string;
  role: AgentRole;
  status: Extract<AgentState, 'completed' | 'failed' | 'cancelled'>;
  report?: WorkerReport;
  error?: string;
};

export type AgentInferenceRequest = {
  agentId: string;
  role: AgentRole;
  model: AgentModelIdentity;
  objective: string;
  messages: LgsMessage[];
  signal: AbortSignal;
};

export interface AgentInference {
  run(request: AgentInferenceRequest): Promise<string>;
}
