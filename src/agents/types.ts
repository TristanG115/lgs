import type { ExecutionCapability } from '../interaction/types.js';

export type AgentProfileDefinition = {
  id: string;
  name: string;
  description: string;
  allowedSkills: string[];
  preferredSkills: string[];
  capabilities: ExecutionCapability[];
  providerId?: string;
  model?: string;
  reasoning?: 'low' | 'medium' | 'high';
  permissions: { read: boolean; edit: boolean; commands: boolean; web: boolean };
  verificationRequired: boolean;
};
export type PluginDefinition = { id: string; name: string; description: string; source: string; enabled: boolean; permissions: string[] };
export type ExtensionSourceType = 'marketplace' | 'git' | 'local' | 'package' | 'registry';
export interface ExtensionSource<T> { id: string; type: ExtensionSourceType; search(query: string): Promise<T[]>; inspect(id: string): Promise<T>; install(id: string, scope: 'global' | 'project'): Promise<T>; update(id: string): Promise<T>; uninstall(id: string): Promise<void>; }
