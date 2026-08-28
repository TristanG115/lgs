import type { ExecutionCapability } from '../interaction/types.js';

export type ProfileOrigin = 'built-in' | 'user';
export type ResearchBehavior = 'available' | 'prefer-current-sources' | 'required-for-changing-facts';
export type ExecutionBehavior = 'conservative' | 'balanced' | 'autonomous';

export type AgentProfilePolicy = {
  preferences: string[];
  defaults: { reasoning?: 'low' | 'medium' | 'high'; skills: string[]; research: ResearchBehavior; tools: ExecutionCapability[] };
  requirements: string[];
  restrictions: { code?: 'allow' | 'deny'; commands?: 'allow' | 'deny'; web?: 'allow' | 'deny' };
};

export type AgentProfileDefinition = {
  id: string; name: string; description: string; origin: ProfileOrigin; modified: boolean; instructions: string;
  preferredSkills: string[]; autoLoadedSkills: string[]; providerId?: string; model?: string; reasoning?: 'low' | 'medium' | 'high';
  toolPreferences: ExecutionCapability[]; researchBehavior: ResearchBehavior; executionBehavior: ExecutionBehavior;
  verificationExpectations: string[]; policy: AgentProfilePolicy;
};

export type AgentProfileDraft = Omit<AgentProfileDefinition, 'origin' | 'modified' | 'policy'> & { policy?: Partial<AgentProfilePolicy> };
export type PluginDefinition = { id: string; name: string; description: string; source: string; enabled: boolean; permissions: string[] };
export type ExtensionSourceType = 'marketplace' | 'git' | 'local' | 'package' | 'registry';
export interface ExtensionSource<T> { id: string; type: ExtensionSourceType; search(query: string): Promise<T[]>; inspect(id: string): Promise<T>; install(id: string, scope: 'global' | 'project'): Promise<T>; update(id: string): Promise<T>; uninstall(id: string): Promise<void>; }
