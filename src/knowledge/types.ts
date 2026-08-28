export type SkillMetadata = {
  name: string;
  description: string;
  applicableTasks: string[];
  activationRules: string[];
  estimatedTokenCost: number;
  scope?: 'global' | 'project';
  enabled?: boolean;
  source?: string;
  compatibility?: string[];
  routing?: { profiles: string[]; activation: 'automatic' | 'manual' };
};

export type WorkspaceSkill = SkillMetadata & { id: string; path: string; supportingFiles: string[]; content: string; scope: 'global' | 'project'; enabled: boolean; source: string; valid: boolean; validationErrors: string[] };
export type SkillCreateInput = { name: string; description: string; instructions: string; scope?: 'project' | 'global'; supportingFiles?: { path: string; content: string }[]; routing?: { profiles: string[]; activation: 'automatic' | 'manual' } };
export type MemoryKind = 'architecture-decision' | 'project-convention' | 'debugging-discovery' | 'implementation-pattern' | 'approved-behavior';
export type ProjectMemory = { id: string; kind: MemoryKind; content: string; tags: string[]; createdAt: string; updatedAt: string; lastAccessedAt: string; accessCount: number };
export type MemoryConfiguration = { enabled: boolean; retentionDays: number; maxEntries: number; maxRetrievedTokens: number };
