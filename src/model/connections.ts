import { randomUUID } from 'node:crypto';
import type * as vscode from 'vscode';
import type { FilePricingStore } from '../usage/store.js';
import { createBackend, loadProfiles, normalizeProfile, saveProfiles, type BackendProfile, type ProviderKind } from './profiles.js';
import { ProviderDiagnosticsStore, testProviderConnection, type ConnectionTestResult } from './diagnostics.js';
import { ManagedOllamaService, type OllamaLogEntry, type OllamaRuntimeInfo } from './ollama-runtime.js';

export type ConnectionDraft = Partial<BackendProfile> & {
  apiKey?: string;
  secretHeaders?: Record<string, string>;
  removeApiKey?: boolean;
};

export class ProviderConnectionService {
  constructor(
    private readonly context: vscode.ExtensionContext,
    readonly diagnostics: ProviderDiagnosticsStore,
    private readonly pricing?: FilePricingStore,
    readonly ollama = new ManagedOllamaService(),
  ) {}

  profiles(): BackendProfile[] { return loadProfiles(this.context); }

  async save(draft: ConnectionDraft): Promise<BackendProfile> {
    const profiles = this.profiles();
    const previous = draft.id ? profiles.find(profile => profile.id === draft.id) : undefined;
    const id = previous?.id || randomUUID();
    const profile = normalizeProfile({ ...previous, ...draft, id });
    const error = validateProfile(profile); if (error) throw new Error(error);
    profile.secretName = profile.secretName || `lgs.connection.${id}.api`;
    profile.secretHeaderNames = [...new Set([...(draft.secretHeaderNames || previous?.secretHeaderNames || []), ...Object.keys(draft.secretHeaders || {})])];
    await saveProfiles(this.context, [...profiles.filter(candidate => candidate.id !== id), profile]);
    if (draft.removeApiKey) await this.context.secrets.delete(profile.secretName);
    else if (draft.apiKey) await this.context.secrets.store(profile.secretName, draft.apiKey);
    for (const [name, value] of Object.entries(draft.secretHeaders || {})) if (value) await this.context.secrets.store(secretHeaderKey(id, name), value);
    for (const name of previous?.secretHeaderNames || []) if (!profile.secretHeaderNames.includes(name)) await this.context.secrets.delete(secretHeaderKey(id, name));
    this.updatePricing(profile);
    await this.diagnostics.record({ connectionId: id, type: 'lifecycle', operation: previous ? 'connection updated' : 'connection created', result: 'success', message: `${profile.name} ${previous ? 'updated' : 'created'}.` });
    return profile;
  }

  async delete(id: string): Promise<boolean> {
    const profiles = this.profiles(); const profile = profiles.find(candidate => candidate.id === id); if (!profile) return false;
    await saveProfiles(this.context, profiles.filter(candidate => candidate.id !== id));
    if (profile.secretName) await this.context.secrets.delete(profile.secretName);
    for (const name of profile.secretHeaderNames) await this.context.secrets.delete(secretHeaderKey(id, name));
    this.removePricing(id); await this.diagnostics.remove(id); return true;
  }

  async setEnabled(id: string, enabled: boolean): Promise<BackendProfile | undefined> {
    const profile = this.profiles().find(candidate => candidate.id === id); if (!profile) return;
    const updated = await this.save({ ...profile, enabled });
    await this.diagnostics.updateStatus(id, enabled ? { state: 'unknown', message: 'Reconnect or test this connection.' } : { state: 'disabled', message: 'This connection is disabled.' });
    return updated;
  }

  async test(id: string, signal?: AbortSignal): Promise<ConnectionTestResult> {
    const profile = this.profiles().find(candidate => candidate.id === id); if (!profile) throw new Error('Connection not found.');
    if (!profile.enabled) return disabledResult(profile);
    await this.diagnostics.updateStatus(id, { state: 'testing', checkedAt: new Date().toISOString(), message: 'Testing endpoint, authentication, discovery, and protocol.' });
    const secrets = await this.secrets(profile); const result = await testProviderConnection(profile, createBackend(profile, secrets.apiKey, secrets.headers), signal);
    const previous = this.diagnostics.status(profile);
    await this.diagnostics.updateStatus(id, {
      state: result.state, checkedAt: result.checkedAt, message: result.summary, modelCount: result.models.length,
      lastSuccessfulAt: result.ok ? result.checkedAt : previous.lastSuccessfulAt,
    }, result.ok ? result.models : undefined);
    await this.diagnostics.record({
      connectionId: id, type: result.ok ? 'connection' : 'error', operation: 'connection test', result: result.ok ? 'success' : 'failed',
      message: `${result.summary}${result.guidance ? ` ${result.guidance}` : ''}`, durationMs: result.durationMs,
      raw: JSON.stringify({ endpoint: result.endpoint, checks: result.checks }),
    }, [secrets.apiKey || '', ...Object.values(secrets.headers)]);
    return result;
  }

  async testDraft(draft: ConnectionDraft, signal?: AbortSignal): Promise<ConnectionTestResult> {
    const profile = normalizeProfile({ ...draft, id: draft.id || 'draft', name: draft.name || 'New connection' });
    const error = validateProfile(profile); if (error) throw new Error(error);
    return testProviderConnection(profile, createBackend(profile, draft.apiKey, draft.secretHeaders), signal);
  }

  async reconnectAll(): Promise<ConnectionTestResult[]> {
    const enabled = this.profiles().filter(profile => profile.enabled);
    return Promise.all(enabled.map(profile => this.test(profile.id)));
  }

  async initializeManagedOllama(): Promise<void> {
    for (const profile of this.profiles().filter(item => item.enabled && item.kind === 'ollama')) {
      await this.ollama.initialize(profile, async () => (await this.testDirect(profile.id)).ok);
    }
  }

  async startOllama(id: string): Promise<OllamaRuntimeInfo> { const profile = this.requiredOllama(id); return this.ollama.start(profile, async () => (await this.testDirect(id)).ok); }
  async restartOllama(id: string): Promise<OllamaRuntimeInfo> { const profile = this.requiredOllama(id); return this.ollama.restart(profile, async () => (await this.testDirect(id)).ok); }
  ollamaInfo(id: string): OllamaRuntimeInfo { return this.ollama.info(id); }
  ollamaLogs(id: string): OllamaLogEntry[] { return this.ollama.logs(id); }

  async hasApiKey(profile: BackendProfile): Promise<boolean> { return Boolean(profile.secretName && await this.context.secrets.get(profile.secretName)); }

  private async secrets(profile: BackendProfile): Promise<{ apiKey?: string; headers: Record<string, string> }> {
    const apiKey = profile.secretName ? await this.context.secrets.get(profile.secretName) : undefined;
    const headers: Record<string, string> = {};
    for (const name of profile.secretHeaderNames) { const value = await this.context.secrets.get(secretHeaderKey(profile.id, name)); if (value) headers[name] = value; }
    return { apiKey, headers };
  }
  private requiredOllama(id: string): BackendProfile { const profile = this.profiles().find(item => item.id === id && item.kind === 'ollama'); if (!profile) throw new Error('Ollama connection not found.'); return profile; }
  private async testDirect(id: string): Promise<ConnectionTestResult> {
    const profile = this.profiles().find(candidate => candidate.id === id); if (!profile) throw new Error('Connection not found.');
    const secrets = await this.secrets(profile); return testProviderConnection(profile, createBackend(profile, secrets.apiKey, secrets.headers));
  }

  private updatePricing(profile: BackendProfile): void {
    if (!this.pricing || !profile.pricing) return;
    const entries = this.pricing.read(); entries[profile.id] = profile.pricing; this.pricing.update(entries);
  }
  private removePricing(id: string): void {
    if (!this.pricing) return; const entries = this.pricing.read();
    for (const key of Object.keys(entries)) if (key === id || key.startsWith(`${id}:`)) delete entries[key];
    this.pricing.update(entries);
  }
}

export function defaultBaseUrl(kind: ProviderKind): string {
  if (kind === 'ollama') return 'http://localhost:11434';
  if (kind === 'openai') return 'https://api.openai.com/v1';
  if (kind === 'anthropic') return 'https://api.anthropic.com/v1';
  return 'http://localhost:1234/v1';
}

export function validateProfile(profile: BackendProfile): string | undefined {
  if (!profile.name.trim()) return 'Display Name is required.';
  if (!['ollama', 'openai', 'openai-compatible', 'anthropic'].includes(profile.kind)) return 'Select a supported API type.';
  let url: URL; try { url = new URL(profile.baseUrl); } catch { return 'Enter a valid base URL.'; }
  if (!['http:', 'https:'].includes(url.protocol)) return 'Base URL must use HTTP or HTTPS.';
  if (url.username || url.password) return 'Base URL must not contain embedded credentials.';
  if ([...url.searchParams.keys()].some(name => /api.?key|token|secret|credential/i.test(name))) return 'Base URL must not contain credential query parameters.';
  const unsafe = Object.keys(profile.headers).find(name => /^(authorization|proxy-authorization|x-api-key|api-key)$/i.test(name));
  if (unsafe) return `${unsafe} is credential-bearing and must be entered as an API key or secret header.`;
  for (const [model, context] of Object.entries(profile.contextOverrides)) if (!model || !Number.isInteger(context) || context < 1) return 'Context overrides must map model IDs to positive whole numbers.';
  if (profile.kind === 'ollama' && profile.ollamaManagement && !['lgs-managed', 'external'].includes(profile.ollamaManagement.mode)) return 'Select a supported Ollama server management mode.';
  return;
}

export function secretHeaderKey(id: string, name: string): string { return `lgs.connection.${id}.header.${name}`; }

function disabledResult(profile: BackendProfile): ConnectionTestResult {
  return {
    ok: false, state: 'disabled', title: `${profile.name} is disabled`, endpoint: profile.baseUrl,
    summary: 'Enable the connection before testing it.', guidance: 'Use Enable on the connection card, then retry.', models: [], durationMs: 0,
    checkedAt: new Date().toISOString(), checks: [
      { name: 'reachability', result: 'unavailable', detail: 'Connection disabled.' },
      { name: 'authentication', result: 'unavailable', detail: 'Connection disabled.' },
      { name: 'discovery', result: 'unavailable', detail: 'Connection disabled.' },
      { name: 'protocol', result: 'unavailable', detail: 'Connection disabled.' },
    ],
  };
}
