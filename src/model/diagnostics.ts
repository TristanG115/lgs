import type * as vscode from 'vscode';
import type { UsageRecord } from '../usage/types.js';
import type { ModelBackend } from './backend.js';
import type { BackendProfile } from './profiles.js';
import type { BackendError, ModelInfo } from './types.js';

export type ProviderHealth = 'online' | 'offline' | 'testing' | 'connecting' | 'authentication_failed' | 'rate_limited' | 'degraded' | 'disabled' | 'unknown';
export type ProviderActivityType = 'connection' | 'models' | 'request' | 'retry' | 'cancellation' | 'usage' | 'error' | 'lifecycle';

export type ProviderStatus = {
  state: ProviderHealth;
  checkedAt?: string;
  lastSuccessfulAt?: string;
  message?: string;
  modelCount?: number;
};

export type ProviderActivity = {
  id: string;
  connectionId: string;
  timestamp: string;
  type: ProviderActivityType;
  operation: string;
  result: 'success' | 'failed' | 'cancelled' | 'info';
  message: string;
  model?: string;
  task?: string;
  agent?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  raw?: string;
};

export type ProviderStatistics = {
  firstUsed?: string;
  lastUsed?: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  cancelledRequests: number;
  successRate?: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  activeGenerationMs: number;
  longestRequestMs?: number;
  averageLatencyMs?: number;
  peakLatencyMs?: number;
  averageTokensPerSecond?: number;
  peakTokensPerSecond?: number;
  largestContextUsage?: number;
  mostUsedModel?: string;
  providerReportedCostUsd?: number;
  estimatedCostUsd?: number;
  tasksServed: number;
  agentInvocations: number;
};

export type ConnectionTestResult = {
  ok: boolean;
  state: ProviderHealth;
  title: string;
  endpoint: string;
  summary: string;
  guidance?: string;
  models: ModelInfo[];
  durationMs: number;
  checkedAt: string;
  checks: Array<{ name: 'reachability' | 'authentication' | 'discovery' | 'protocol'; result: 'passed' | 'failed' | 'unavailable'; detail: string }>;
};

type PersistedDiagnostics = { statuses: Record<string, ProviderStatus>; activities: ProviderActivity[]; models: Record<string, ModelInfo[]> };
type GlobalState = Pick<vscode.Memento, 'get' | 'update'>;

const STORAGE_KEY = 'lgs.providerDiagnostics.v1';
const MAX_ACTIVITIES = 500;

export class ProviderDiagnosticsStore {
  constructor(private readonly state: GlobalState, private readonly usageRecords: () => UsageRecord[] = () => []) {}

  status(profile: BackendProfile): ProviderStatus {
    if (!profile.enabled) return { state: 'disabled', message: 'This connection is disabled.' };
    return this.read().statuses[profile.id] || { state: 'unknown', message: 'Not tested in this session.' };
  }

  models(connectionId: string): ModelInfo[] { return this.read().models[connectionId] || []; }

  async updateStatus(connectionId: string, status: ProviderStatus, models?: ModelInfo[]): Promise<void> {
    const value = this.read();
    value.statuses[connectionId] = status;
    if (models) value.models[connectionId] = models.map(model => ({ ...model, capabilities: model.capabilities ? { ...model.capabilities } : undefined }));
    await this.write(value);
  }

  async record(entry: Omit<ProviderActivity, 'id' | 'timestamp'> & { id?: string; timestamp?: string }, secrets: string[] = []): Promise<void> {
    const value = this.read();
    value.activities.push({
      ...entry,
      id: entry.id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: entry.timestamp || new Date().toISOString(),
      message: redactProviderText(entry.message, secrets),
      raw: entry.raw ? redactProviderText(entry.raw, secrets) : undefined,
    });
    value.activities = value.activities.slice(-MAX_ACTIVITIES);
    await this.write(value);
  }

  async remove(connectionId: string): Promise<void> {
    const value = this.read();
    delete value.statuses[connectionId]; delete value.models[connectionId];
    value.activities = value.activities.filter(entry => entry.connectionId !== connectionId);
    await this.write(value);
  }

  activities(connectionId: string): ProviderActivity[] {
    const stored = this.read().activities.filter(entry => entry.connectionId === connectionId);
    const usage = this.usageRecords().filter(record => record.providerConnection === connectionId).map(usageActivity);
    return [...stored, ...usage].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 250);
  }

  statistics(connectionId: string): ProviderStatistics {
    return aggregateProviderStatistics(this.usageRecords().filter(record => record.providerConnection === connectionId));
  }

  private read(): PersistedDiagnostics {
    const value = this.state.get<Partial<PersistedDiagnostics>>(STORAGE_KEY) || {};
    return { statuses: value.statuses || {}, activities: value.activities || [], models: value.models || {} };
  }

  private async write(value: PersistedDiagnostics): Promise<void> { await this.state.update(STORAGE_KEY, value); }
}

export async function testProviderConnection(
  profile: BackendProfile,
  backend: ModelBackend,
  signal?: AbortSignal,
): Promise<ConnectionTestResult> {
  const started = performance.now(); const checkedAt = new Date().toISOString();
  try {
    const models = await (backend.probeModels ? backend.probeModels(signal) : backend.listModels(signal));
    const durationMs = Math.round(performance.now() - started);
    const discoveryAvailable = profile.discoveryMode !== 'disabled';
    return {
      ok: true, state: models.length || !discoveryAvailable ? 'online' : 'degraded',
      title: `${profile.name} is reachable`, endpoint: profile.baseUrl,
      summary: discoveryAvailable ? `${models.length} model${models.length === 1 ? '' : 's'} discovered in ${durationMs} ms.` : `Endpoint responded in ${durationMs} ms; discovery is disabled.`,
      guidance: models.length || !discoveryAvailable ? undefined : 'The endpoint accepted the request but returned no models. Verify that at least one model is installed or exposed.',
      models, durationMs, checkedAt,
      checks: [
        { name: 'reachability', result: 'passed', detail: 'Endpoint responded.' },
        { name: 'authentication', result: 'passed', detail: profile.secretName ? 'The authenticated request was accepted.' : 'No credential was configured or required.' },
        { name: 'discovery', result: discoveryAvailable ? 'passed' : 'unavailable', detail: discoveryAvailable ? `${models.length} models returned.` : 'Discovery is disabled for this profile.' },
        { name: 'protocol', result: 'passed', detail: 'The response matched the selected adapter.' },
      ],
    };
  } catch (error) {
    const durationMs = Math.round(performance.now() - started);
    const diagnostic = normalizeProviderError(error, profile);
    return {
      ok: false, state: diagnostic.state, title: `Unable to connect to ${profile.name}`, endpoint: profile.baseUrl,
      summary: diagnostic.summary, guidance: diagnostic.guidance, models: [], durationMs, checkedAt,
      checks: [
        { name: 'reachability', result: diagnostic.state === 'offline' ? 'failed' : 'passed', detail: diagnostic.state === 'offline' ? diagnostic.summary : 'The endpoint returned a response.' },
        { name: 'authentication', result: diagnostic.state === 'authentication_failed' ? 'failed' : 'unavailable', detail: diagnostic.state === 'authentication_failed' ? diagnostic.summary : 'Authentication could not be confirmed.' },
        { name: 'discovery', result: 'failed', detail: 'Model discovery did not complete.' },
        { name: 'protocol', result: diagnostic.state === 'degraded' ? 'failed' : 'unavailable', detail: diagnostic.state === 'degraded' ? diagnostic.summary : 'Protocol compatibility could not be confirmed.' },
      ],
    };
  }
}

export function normalizeProviderError(error: unknown, profile: Pick<BackendProfile, 'kind' | 'name' | 'baseUrl'>): { state: ProviderHealth; summary: string; guidance?: string } {
  const backend = asBackendError(error); const causeCode = nestedCode(error); const raw = errorText(error);
  if (backend?.code === 'authentication' || /\b(401|403|unauthori[sz]ed|forbidden|invalid api key)\b/i.test(raw)) {
    return { state: 'authentication_failed', summary: 'Authentication was rejected by the provider.', guidance: 'Update the stored API key or secret headers, then retry.' };
  }
  if (backend?.code === 'rate_limit' || /\b429\b|rate.?limit/i.test(raw)) {
    return { state: 'rate_limited', summary: 'The provider is rate limiting requests.', guidance: 'Wait for the provider retry window, then try again.' };
  }
  if (causeCode === 'ECONNREFUSED' || /ECONNREFUSED|connection refused/i.test(raw)) {
    return { state: 'offline', summary: 'Connection refused.', guidance: profile.kind === 'ollama' ? 'Ollama may not be running. Start it, verify the endpoint, and retry.' : 'Verify that the service is running and that the host and port are correct.' };
  }
  if (causeCode === 'ENOTFOUND' || /ENOTFOUND|getaddrinfo|name.*not resolved/i.test(raw)) {
    return { state: 'offline', summary: 'The provider host could not be resolved.', guidance: 'Check the hostname, network connection, VPN, and proxy settings.' };
  }
  if (error instanceof Error && error.name === 'AbortError') return { state: 'offline', summary: 'Connection test was cancelled.', guidance: 'Retry when ready.' };
  if (/timed? ?out|ETIMEDOUT/i.test(raw)) return { state: 'offline', summary: 'The provider did not respond before the timeout.', guidance: 'Check the endpoint and network, then retry.' };
  if (backend?.code === 'server') return { state: 'degraded', summary: `The provider returned a server error${backend.status ? ` (${backend.status})` : ''}.`, guidance: 'Check provider health or local runtime logs, then retry.' };
  if (backend?.code === 'invalid_request' || /invalid json|unexpected token|404|405/i.test(raw)) return { state: 'degraded', summary: 'The endpoint responded, but its discovery protocol did not match the selected API type.', guidance: 'Verify the API type, base URL, and optional discovery path.' };
  return { state: 'offline', summary: raw && raw !== 'fetch failed' ? redactProviderText(raw) : 'The endpoint could not be reached.', guidance: 'Check the endpoint, local runtime, network, and proxy settings, then retry.' };
}

export function redactProviderText(value: string, secrets: string[] = []): string {
  let redacted = value;
  for (const secret of secrets.filter(Boolean)) redacted = redacted.split(secret).join('[REDACTED]');
  return redacted
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;"'}]+/gi, '$1[REDACTED]')
    .replace(/((?:api[-_ ]?key|access[-_ ]?token|secret|credential)\s*[:=]\s*)[^\s,;"'}]+/gi, '$1[REDACTED]')
    .replace(/\b(?:sk|key|token)-[A-Za-z0-9._-]{8,}\b/g, '[REDACTED]')
    .replace(/([?&](?:api_key|key|token|access_token)=)[^&\s]+/gi, '$1[REDACTED]');
}

export function aggregateProviderStatistics(records: UsageRecord[]): ProviderStatistics {
  const ordered = [...records].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const successful = records.filter(record => record.result === 'success').length;
  const failed = records.filter(record => record.result === 'failed').length;
  const cancelled = records.filter(record => record.result === 'cancelled').length;
  const knownOutcomes = successful + failed + cancelled;
  const latencies = records.flatMap(record => record.latencyMs === undefined ? [] : [record.latencyMs]);
  const speeds = records.flatMap(record => record.tokensPerSecond === undefined ? [] : [record.tokensPerSecond]);
  const models = new Map<string, number>();
  for (const record of records) if (record.model) models.set(record.model, (models.get(record.model) || 0) + 1);
  const reported = records.flatMap(record => record.providerReportedCostUsd === undefined ? [] : [record.providerReportedCostUsd]);
  const estimated = records.flatMap(record => record.estimatedCostUsd === undefined ? [] : [record.estimatedCostUsd]);
  return {
    firstUsed: ordered[0]?.timestamp, lastUsed: ordered.at(-1)?.timestamp, totalRequests: records.length,
    successfulRequests: successful, failedRequests: failed, cancelledRequests: cancelled,
    successRate: knownOutcomes ? successful / knownOutcomes : undefined,
    inputTokens: sum(records, 'inputTokens'), outputTokens: sum(records, 'outputTokens'), cachedTokens: sum(records, 'cachedTokens'), reasoningTokens: sum(records, 'reasoningTokens'),
    totalTokens: records.reduce((total, record) => total + (record.inputTokens || 0) + (record.outputTokens || 0), 0),
    activeGenerationMs: sum(records, 'generationMs'), longestRequestMs: maximum(latencies),
    averageLatencyMs: average(latencies), peakLatencyMs: maximum(latencies), averageTokensPerSecond: average(speeds), peakTokensPerSecond: maximum(speeds),
    largestContextUsage: maximum(records.flatMap(record => record.contextUtilized === undefined ? [] : [record.contextUtilized])),
    mostUsedModel: [...models.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0],
    providerReportedCostUsd: reported.length ? reported.reduce((a, b) => a + b, 0) : undefined,
    estimatedCostUsd: estimated.length ? estimated.reduce((a, b) => a + b, 0) : undefined,
    tasksServed: new Set(records.flatMap(record => record.task ? [record.task] : [])).size,
    agentInvocations: new Set(records.flatMap(record => record.agent ? [record.agent] : [])).size,
  };
}

function usageActivity(record: UsageRecord): ProviderActivity {
  const result = record.result === 'failed' ? 'failed' : record.result === 'cancelled' ? 'cancelled' : record.result === 'success' ? 'success' : 'info';
  return {
    id: `usage-${record.id}`, connectionId: record.providerConnection || 'unknown', timestamp: record.timestamp,
    type: result === 'cancelled' ? 'cancellation' : result === 'failed' ? 'error' : 'request', operation: 'model request', result,
    message: result === 'info' ? 'Request metrics recorded; outcome unavailable.' : `Request ${result}.`, model: record.model, task: record.task,
    agent: record.agent, durationMs: record.latencyMs, inputTokens: record.inputTokens, outputTokens: record.outputTokens,
    cachedTokens: record.cachedTokens, reasoningTokens: record.reasoningTokens,
  };
}

function asBackendError(value: unknown): BackendError | undefined {
  if (typeof value !== 'object' || value === null) return;
  const candidate = value as Partial<BackendError>;
  return typeof candidate.code === 'string' && typeof candidate.message === 'string' ? candidate as BackendError : undefined;
}
function nestedCode(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return;
  const candidate = value as { code?: unknown; cause?: unknown };
  if (typeof candidate.code === 'string') return candidate.code;
  return nestedCode(candidate.cause);
}
function errorText(value: unknown): string {
  if (value instanceof Error) return [value.message, errorText(value.cause)].filter(Boolean).join(' ');
  if (typeof value === 'object' && value !== null && typeof (value as { message?: unknown }).message === 'string') return (value as { message: string }).message;
  return typeof value === 'string' ? value : '';
}
function sum(records: UsageRecord[], key: 'inputTokens' | 'outputTokens' | 'cachedTokens' | 'reasoningTokens' | 'generationMs'): number { return records.reduce((total, record) => total + (record[key] || 0), 0); }
function average(values: number[]): number | undefined { return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 100) / 100 : undefined; }
function maximum(values: number[]): number | undefined { return values.length ? Math.max(...values) : undefined; }
