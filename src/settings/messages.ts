import type { ConnectionTestResult, ProviderActivity, ProviderStatistics, ProviderStatus } from '../model/diagnostics.js';
import type { BackendProfile } from '../model/profiles.js';
import type { ModelInfo } from '../model/types.js';
import type { EffectiveSetting } from './registry.js';

export type SettingsScope = 'user' | 'workspace';
export type LifecycleAction = 'restartServices' | 'reconnectProviders' | 'restartLocalRuntimes' | 'reloadViews' | 'reloadWindow';

export type SafeConnection = Omit<BackendProfile, 'secretName'> & {
  hasApiKey: boolean;
  status: ProviderStatus;
  models: ModelInfo[];
  statistics: ProviderStatistics;
  activities: ProviderActivity[];
};

export type SettingsState = {
  type: 'state';
  settings: EffectiveSetting[];
  errors: string[];
  connections: SafeConnection[];
  workspaceOpen: boolean;
};

export type SettingsHostMessage = SettingsState
  | { type: 'notice'; message: string; tone?: 'info' | 'success' | 'warning' | 'error' }
  | { type: 'connectionResult'; id: string; result: ConnectionTestResult; draft?: boolean }
  | { type: 'lifecycleResult'; action: LifecycleAction; ok: boolean; message: string };

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
  | { type: 'refreshState' };

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
  return;
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
