import type { AgentModelIdentity, ConfiguredAgentModel } from '../orchestration/types.js';
import type { ProviderDataPolicy } from '../model/profiles.js';

export const ROUTING_ROLES = ['fast', 'worker', 'manager', 'researcher', 'documentation', 'reviewer', 'difficult', 'vision', 'cloudEscalation'] as const;
export type RoutingRole = typeof ROUTING_ROLES[number];
export type PrivacyPolicy = 'local_only' | 'cloud_allowed' | 'ask_before_cloud';
export type CostTier = 'low' | 'medium' | 'high';
export type ModelRoute = ConfiguredAgentModel & {
  contextWindow?: number;
  toolSupport?: boolean;
  vision?: boolean;
  costTier?: CostTier;
  benchmarkScore?: number;
  failures?: number;
};
export type RoutingPolicy = {
  privacy: PrivacyPolicy;
  preferLocal: boolean;
  preferCheapest: boolean;
  maxCostTier?: CostTier;
};
export type RoutingConfiguration = {
  roles: Partial<Record<RoutingRole, ModelRoute>>;
  models: ModelRoute[];
  policy: RoutingPolicy;
};
export type RoutingRequest = {
  role: RoutingRole;
  fallback: AgentModelIdentity;
  contextTokens?: number;
  needsTools?: boolean;
  needsVision?: boolean;
  difficulty?: 'low' | 'medium' | 'high';
  taskModel?: ConfiguredAgentModel;
  roleModel?: ConfiguredAgentModel;
  provider?: string;
  taskId?: string;
};
export type RoutingDecision = {
  role: RoutingRole;
  identity: AgentModelIdentity;
  reason: string;
  automatic: boolean;
  policy: PrivacyPolicy;
  recordedAt: string;
  blocked?: boolean;
  requiresApproval?: boolean;
};
export type ProviderPolicyLookup = (profileId: string) => ProviderDataPolicy | undefined;
export type RoutingBudgetGate = (request: RoutingRequest, identity: AgentModelIdentity) => { allowed: boolean; warning?: string } | undefined;
