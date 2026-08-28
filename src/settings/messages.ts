import type { ConnectionTestResult, ProviderActivity, ProviderStatistics, ProviderStatus } from '../model/diagnostics.js';
import type { BackendProfile } from '../model/profiles.js';
import type { ModelInfo } from '../model/types.js';
import type { EffectiveSetting } from './registry.js';
import type { AgentProfileDefinition, AgentProfileDraft, AgentWorkspaceState, PluginDefinition, SkillGenerationDraft } from '../agents/index.js';
import type { WorkspaceSkill } from '../knowledge/types.js';
import type { OllamaLogEntry, OllamaRuntimeInfo } from '../model/ollama-runtime.js';

export type SettingsScope = 'user' | 'workspace';
export type LifecycleAction = 'restartServices' | 'reconnectProviders' | 'restartLocalRuntimes' | 'reloadViews' | 'reloadWindow';

export type SafeConnection = Omit<BackendProfile, 'secretName'> & {
  hasApiKey: boolean;
  status: ProviderStatus;
  models: ModelInfo[];
  statistics: ProviderStatistics;
  activities: ProviderActivity[];
  ollamaRuntime?: OllamaRuntimeInfo;
  ollamaLogs?: OllamaLogEntry[];
};

export type SettingsState = {
  type: 'state';
  settings: EffectiveSetting[];
  errors: string[];
  connections: SafeConnection[];
  workspaceOpen: boolean;
  agentWorkspace?: AgentWorkspaceState;
  skills: Omit<WorkspaceSkill, 'content'>[];
  plugins: PluginDefinition[];
  agentProfiles: AgentProfileDefinition[];
};

export type SettingsHostMessage = SettingsState
  | { type: 'notice'; message: string; tone?: 'info' | 'success' | 'warning' | 'error' }
  | { type: 'connectionResult'; id: string; result: ConnectionTestResult; draft?: boolean }
  | { type: 'lifecycleResult'; action: LifecycleAction; ok: boolean; message: string }
  | { type: 'skillGeneration'; draft: SkillGenerationDraft; question?: string; diff?: string };

export type SettingsClientMessage =
  | { type: 'setAppearance'; theme: 'vscode' | 'lgs-light' | 'lgs-dark'; scope: SettingsScope }
  | { type: 'setSetting'; id: string; value: unknown; scope: SettingsScope }
  | { type: 'saveConnection'; connection: Record<string, unknown> }
  | { type: 'deleteConnection'; id: string }
  | { type: 'setConnectionEnabled'; id: string; enabled: boolean }
  | { type: 'testConnection'; id: string }
  | { type: 'testDraftConnection'; connection: Record<string, unknown> }
  | { type: 'lifecycle'; action: LifecycleAction }
  | { type: 'openWorkspaceConfig' }
  | { type: 'openUsage' }
  | { type: 'refreshState' }
  | { type: 'ollamaAction'; id: string; action: 'start' | 'restart' | 'refresh' }
  | { type: 'initializeAgentWorkspace' }
  | { type: 'createSkill'; name: string; description: string; instructions: string; scope: 'project' | 'global' }
  | { type: 'setSkillEnabled'; name: string; scope: 'project' | 'global'; enabled: boolean }
  | { type: 'openSkill'; path: string }
  | { type: 'importSkill'; scope: 'project' | 'global' }
  | { type: 'prepareSkill'; sessionId: string; existingName?: string; existingScope?: 'project' | 'global'; name: string; work: string; desiredExamples: string; avoid: string; priorities: string; constraints: string; scope: 'project' | 'global'; profiles: string[]; activation: 'automatic' | 'manual' }
  | { type: 'approveSkill'; sessionId: string }
  | { type: 'saveAgentProfile'; profile: AgentProfileDraft; builtIn: boolean; replaceUser?: boolean }
  | { type: 'restoreAgentProfile'; id: string };

export function parseSettingsClientMessage(value: unknown): SettingsClientMessage | undefined {
  if (!record(value) || typeof value.type !== 'string') return;
  const scope = (candidate: unknown): candidate is SettingsScope => candidate === 'user' || candidate === 'workspace';
  if (value.type === 'setAppearance' && ['vscode', 'lgs-light', 'lgs-dark'].includes(String(value.theme)) && scope(value.scope)) return value as SettingsClientMessage;
  if (value.type === 'setSetting' && typeof value.id === 'string' && scope(value.scope)) return value as SettingsClientMessage;
  if ((value.type === 'saveConnection' || value.type === 'testDraftConnection') && record(value.connection)) return value as SettingsClientMessage;
  if ((value.type === 'deleteConnection' || value.type === 'testConnection') && typeof value.id === 'string') return value as SettingsClientMessage;
  if (value.type === 'setConnectionEnabled' && typeof value.id === 'string' && typeof value.enabled === 'boolean') return value as SettingsClientMessage;
  if (value.type === 'lifecycle' && ['restartServices', 'reconnectProviders', 'restartLocalRuntimes', 'reloadViews', 'reloadWindow'].includes(String(value.action))) return value as SettingsClientMessage;
  if (value.type === 'openWorkspaceConfig' || value.type === 'openUsage' || value.type === 'refreshState') return value as SettingsClientMessage;
  if (value.type === 'ollamaAction' && typeof value.id === 'string' && ['start', 'restart', 'refresh'].includes(String(value.action))) return value as SettingsClientMessage;
  if (value.type === 'initializeAgentWorkspace') return { type: 'initializeAgentWorkspace' };
  if (value.type === 'createSkill' && typeof value.name === 'string' && typeof value.description === 'string' && typeof value.instructions === 'string' && ['project', 'global'].includes(String(value.scope))) return value as SettingsClientMessage;
  if (value.type === 'setSkillEnabled' && typeof value.name === 'string' && ['project', 'global'].includes(String(value.scope)) && typeof value.enabled === 'boolean') return value as SettingsClientMessage;
  if (value.type === 'openSkill' && typeof value.path === 'string' && value.path.length <= 4096) return value as SettingsClientMessage;
  if (value.type === 'importSkill' && ['project', 'global'].includes(String(value.scope))) return value as SettingsClientMessage;
  if (value.type === 'prepareSkill' && typeof value.sessionId === 'string' && typeof value.name === 'string' && typeof value.work === 'string' && typeof value.desiredExamples === 'string' && typeof value.avoid === 'string' && typeof value.priorities === 'string' && typeof value.constraints === 'string' && ['project', 'global'].includes(String(value.scope)) && Array.isArray(value.profiles) && value.profiles.every(item => typeof item === 'string') && ['automatic', 'manual'].includes(String(value.activation))) return value as SettingsClientMessage;
  if (value.type === 'approveSkill' && typeof value.sessionId === 'string') return value as SettingsClientMessage;
  if (value.type === 'saveAgentProfile' && record(value.profile) && typeof value.builtIn === 'boolean' && (value.replaceUser === undefined || typeof value.replaceUser === 'boolean')) return value as SettingsClientMessage;
  if (value.type === 'restoreAgentProfile' && typeof value.id === 'string') return value as SettingsClientMessage;
  return;
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
