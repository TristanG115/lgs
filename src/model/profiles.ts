import * as vscode from 'vscode';
import type { UsageBillingKind } from '../usage/types.js';
import { AnthropicBackend } from './anthropic.js';
import type { BackendConfig, ModelBackend } from './backend.js';
import { OllamaBackend } from './ollama.js';
import { OpenAICompatibleBackend } from './openai.js';
import type { ConnectionState, GenerationOptions, LgsMessage, ModelCapabilities, ModelInfo, StreamEvent } from './types.js';

export type ProviderKind = 'ollama' | 'openai' | 'openai-compatible' | 'anthropic';
export type ProviderDataPolicy = 'local' | 'cloud' | 'repository_allowed' | 'metadata_only';
export type ModelDiscoveryMode = 'automatic' | 'manual' | 'disabled';

export type ProviderPricing = {
  billing: UsageBillingKind;
  inputPerMillionUsd?: number;
  cachedInputPerMillionUsd?: number;
  outputPerMillionUsd?: number;
};

export type BackendProfile = {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  enabled: boolean;
  secretName?: string;
  headers: Record<string, string>;
  secretHeaderNames: string[];
  discoveryMode: ModelDiscoveryMode;
  discoveryPath?: string;
  manualModels: string[];
  modelAliases: Record<string, string>;
  capabilityOverrides: Partial<ModelCapabilities>;
  contextOverrides: Record<string, number>;
  pricing?: ProviderPricing;
  dataPolicy?: ProviderDataPolicy;
  ollamaManagement?: { mode: 'lgs-managed' | 'external'; autoStart: boolean; executable?: string };
};

export const defaultProfiles = (): BackendProfile[] => [
  {
    id: 'ollama-local', name: 'Local Ollama', kind: 'ollama', baseUrl: 'http://localhost:11434', enabled: true,
    headers: {}, secretHeaderNames: [], discoveryMode: 'automatic', manualModels: [], modelAliases: {},
    capabilityOverrides: {}, contextOverrides: {}, pricing: { billing: 'local' }, dataPolicy: 'local',
    ollamaManagement: { mode: 'lgs-managed', autoStart: true },
  },
  {
    id: 'openai', name: 'Personal OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', enabled: true,
    secretName: 'lgs.secret.openai', headers: {}, secretHeaderNames: [], discoveryMode: 'automatic', manualModels: [],
    modelAliases: {}, capabilityOverrides: {}, contextOverrides: {}, pricing: { billing: 'commercial' },
    dataPolicy: 'repository_allowed',
  },
  {
    id: 'openai-local', name: 'OpenAI Compatible (local)', kind: 'openai-compatible', baseUrl: 'http://localhost:1234/v1',
    enabled: true, headers: {}, secretHeaderNames: [], discoveryMode: 'automatic', manualModels: [], modelAliases: {},
    capabilityOverrides: {}, contextOverrides: {}, pricing: { billing: 'local' }, dataPolicy: 'local',
  },
  {
    id: 'anthropic', name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', enabled: true,
    secretName: 'lgs.secret.anthropic', headers: {}, secretHeaderNames: [], discoveryMode: 'automatic', manualModels: [],
    modelAliases: {}, capabilityOverrides: {}, contextOverrides: {}, pricing: { billing: 'commercial' },
    dataPolicy: 'repository_allowed',
  },
];

export function normalizeProfile(value: Partial<BackendProfile>): BackendProfile {
  const defaults = defaultProfiles().find(profile => profile.id === value.id);
  const merged = { ...defaults, ...value };
  return {
    id: merged.id || '',
    name: merged.name || merged.id || 'Connection',
    kind: merged.kind || 'openai-compatible',
    baseUrl: merged.baseUrl || '',
    enabled: merged.enabled !== false,
    secretName: merged.secretName,
    headers: merged.headers || {},
    secretHeaderNames: [...new Set(merged.secretHeaderNames || [])],
    discoveryMode: merged.discoveryMode || 'automatic',
    discoveryPath: merged.discoveryPath,
    manualModels: [...new Set(merged.manualModels || [])],
    modelAliases: merged.modelAliases || {},
    capabilityOverrides: merged.capabilityOverrides || {},
    contextOverrides: merged.contextOverrides || {},
    pricing: merged.pricing,
    dataPolicy: merged.dataPolicy,
    ollamaManagement: merged.kind === 'ollama' ? merged.ollamaManagement || { mode: 'external', autoStart: false } : undefined,
  };
}

export function loadProfiles(context: vscode.ExtensionContext): BackendProfile[] {
  const stored = context.globalState.get<Partial<BackendProfile>[]>('lgs.connections')
    || context.globalState.get<Partial<BackendProfile>[]>('lgs.profiles');
  return (stored?.length ? stored : defaultProfiles()).map(normalizeProfile);
}

export async function saveProfiles(context: vscode.ExtensionContext, profiles: BackendProfile[]): Promise<void> {
  await context.globalState.update('lgs.connections', profiles.map(profile => normalizeProfile(profile)));
}

export function createBackend(profile: BackendProfile, secret?: string, secretHeaders: Record<string, string> = {}): ModelBackend {
  const config: BackendConfig = {
    id: profile.id,
    displayName: profile.name,
    baseUrl: profile.baseUrl,
    secretKey: secret,
    headers: { ...profile.headers, ...secretHeaders },
    discoveryPath: profile.discoveryPath,
  };
  const backend: ModelBackend = profile.kind === 'ollama'
    ? new OllamaBackend(config)
    : profile.kind === 'anthropic'
      ? new AnthropicBackend(config)
      : new OpenAICompatibleBackend(config);
  Object.assign(backend.capabilities, profile.capabilityOverrides);
  return new ProfileBackend(profile, backend);
}

export function profileBilling(profile: BackendProfile): UsageBillingKind {
  return profile.pricing?.billing || (profile.dataPolicy === 'local' ? 'local' : 'unknown');
}

class ProfileBackend implements ModelBackend {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: ModelCapabilities;

  constructor(private readonly profile: BackendProfile, private readonly backend: ModelBackend) {
    this.id = profile.id;
    this.displayName = profile.name;
    this.capabilities = backend.capabilities;
  }

  getConnectionState(): ConnectionState { return this.backend.getConnectionState(); }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    if (this.profile.discoveryMode === 'disabled') return [];
    const models: ModelInfo[] = this.profile.discoveryMode === 'manual'
      ? this.profile.manualModels.map(id => ({ id }))
      : await this.backend.listModels(signal);
    return models.map(model => ({
      ...model,
      displayName: this.profile.modelAliases[model.id] || model.displayName,
      contextWindow: this.profile.contextOverrides[model.id] || model.contextWindow,
      capabilities: { ...model.capabilities, ...this.profile.capabilityOverrides },
    }));
  }

  async probeModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const discovered = await this.backend.listModels(signal);
    return this.profile.discoveryMode === 'manual' ? this.listModels(signal) : discovered;
  }

  streamChat(model: string, messages: LgsMessage[], options?: GenerationOptions, signal?: AbortSignal): AsyncIterable<StreamEvent> {
    return this.backend.streamChat(model, messages, options, signal);
  }
}
