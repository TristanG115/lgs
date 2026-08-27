import { describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { ProviderConnectionService } from '../src/model/connections.js';
import { aggregateProviderStatistics, normalizeProviderError, ProviderDiagnosticsStore, redactProviderText, testProviderConnection, type ConnectionTestResult } from '../src/model/diagnostics.js';
import { createBackend, normalizeProfile } from '../src/model/profiles.js';
import type { ModelBackend } from '../src/model/backend.js';
import type { UsageRecord } from '../src/usage/types.js';
import { LgsLifecycleService } from '../src/settings/lifecycle.js';

function fakeContext(): vscode.ExtensionContext & { values: Record<string, unknown>; secretValues: Map<string, string> } {
  const values: Record<string, unknown> = {}; const secretValues = new Map<string, string>();
  return {
    values, secretValues,
    globalState: { get: <T>(key: string) => values[key] as T, update: async (key: string, value: unknown) => { values[key] = value; }, keys: () => Object.keys(values), setKeysForSync: () => {} },
    secrets: { get: async key => secretValues.get(key), store: async (key, value) => { secretValues.set(key, value); }, delete: async key => { secretValues.delete(key); }, onDidChange: (() => ({ dispose() {} })) as never },
  } as unknown as vscode.ExtensionContext & { values: Record<string, unknown>; secretValues: Map<string, string> };
}

const profile = (id = 'research-gateway') => normalizeProfile({ id, name: 'Purdue GenAI', kind: 'openai-compatible', baseUrl: 'https://genai.example.edu/v1', enabled: true, discoveryMode: 'automatic', pricing: { billing: 'institution_provided' }, dataPolicy: 'repository_allowed' });

describe('provider connection management', () => {
  it('creates and edits arbitrary display names without coupling them to adapter identity', async () => {
    const context = fakeContext(); const diagnostics = new ProviderDiagnosticsStore(context.globalState); const service = new ProviderConnectionService(context, diagnostics);
    const created = await service.save({ name: 'Purdue GenAI', kind: 'openai-compatible', baseUrl: 'https://gateway.example/v1', apiKey: 'secret-value' });
    expect(created.id).toBeTruthy(); expect(created.id).not.toBe(created.name); expect(created.kind).toBe('openai-compatible');
    const edited = await service.save({ ...created, name: 'Research Gateway' });
    expect(edited.id).toBe(created.id); expect(edited.name).toBe('Research Gateway'); expect(edited.kind).toBe('openai-compatible');
    expect(JSON.stringify(context.values)).not.toContain('secret-value'); expect([...context.secretValues.values()]).toContain('secret-value');
  });

  it('stores normal metadata separately from API keys and secret headers, then removes all managed secrets', async () => {
    const context = fakeContext(); const service = new ProviderConnectionService(context, new ProviderDiagnosticsStore(context.globalState));
    const created = await service.save({ name: 'Local Beast', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:1234/v1', headers: { 'X-Client': 'LGS' }, apiKey: 'api-secret', secretHeaders: { 'X-Institution-Key': 'header-secret' } });
    const serialized = JSON.stringify(context.values); expect(serialized).toContain('X-Client'); expect(serialized).not.toContain('api-secret'); expect(serialized).not.toContain('header-secret');
    expect(await service.delete(created.id)).toBe(true); expect(context.secretValues.size).toBe(0);
  });

  it('keeps same-adapter connections and same model IDs distinct', async () => {
    const first = normalizeProfile({ ...profile('first'), manualModels: ['shared-model'], discoveryMode: 'manual' });
    const second = normalizeProfile({ ...profile('second'), name: 'Personal Gateway', manualModels: ['shared-model'], discoveryMode: 'manual' });
    expect((await createBackend(first).listModels())[0].id).toBe('shared-model'); expect((await createBackend(second).listModels())[0].id).toBe('shared-model');
    expect(createBackend(first).id).toBe('first'); expect(createBackend(second).id).toBe('second');
  });

  it('tests all enabled adapters during reconnect and persists live status/model discovery', async () => {
    const context = fakeContext(); const diagnostics = new ProviderDiagnosticsStore(context.globalState); const service = new ProviderConnectionService(context, diagnostics);
    context.values['lgs.connections'] = [
      normalizeProfile({ id: 'ollama-one', name: 'Ollama One', kind: 'ollama', baseUrl: 'http://ollama.test', enabled: true }),
      normalizeProfile({ id: 'openai-one', name: 'OpenAI One', kind: 'openai-compatible', baseUrl: 'https://openai.test/v1', enabled: true }),
    ];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input); return url.includes('/api/tags')
        ? new Response(JSON.stringify({ models: [{ name: 'llama' }] }), { status: 200 })
        : new Response(JSON.stringify({ data: [{ id: 'gpt-test' }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const results = await service.reconnectAll();
    expect(results.map(result => result.ok)).toEqual([true, true]); expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(diagnostics.status(service.profiles()[0])).toMatchObject({ state: 'online', modelCount: 1 });
    expect(diagnostics.models('openai-one')).toEqual([expect.objectContaining({ id: 'gpt-test' })]);
    vi.unstubAllGlobals();
  });
});

describe('provider diagnostics and statistics', () => {
  it('returns actionable offline and authentication diagnostics instead of fetch failed', () => {
    const refused = new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
    expect(normalizeProviderError(refused, profile())).toMatchObject({ state: 'offline', summary: 'Connection refused.' });
    expect(normalizeProviderError({ code: 'authentication', message: '401 Unauthorized', retryable: false }, profile())).toMatchObject({ state: 'authentication_failed' });
  });

  it('exercises endpoint discovery and protocol validation through the normalized backend contract', async () => {
    const backend: ModelBackend = { id: 'test', displayName: 'Test', capabilities: { streaming: true, multimodal: false, systemInstructions: true, cancellation: true, usage: true, reasoning: false }, getConnectionState: () => 'connected', listModels: async () => [{ id: 'model-a' }], streamChat: async function* () { yield { type: 'done' }; } };
    const result = await testProviderConnection(profile(), backend);
    expect(result).toMatchObject({ ok: true, state: 'online', models: [{ id: 'model-a' }] }); expect(result.checks.every(check => check.result === 'passed')).toBe(true);
  });

  it('redacts authorization, API keys, secret headers, tokens, and explicit secret values', async () => {
    const raw = 'Authorization: Bearer abcdefghi api_key=topsecret token-longsecret X-Key=private-value';
    const redacted = redactProviderText(raw, ['private-value']);
    expect(redacted).not.toContain('abcdefghi'); expect(redacted).not.toContain('topsecret'); expect(redacted).not.toContain('longsecret'); expect(redacted).not.toContain('private-value');
    const context = fakeContext(); const store = new ProviderDiagnosticsStore(context.globalState);
    await store.record({ connectionId: 'one', type: 'error', operation: 'test', result: 'failed', message: raw, raw }, ['private-value']);
    expect(JSON.stringify(context.values)).not.toMatch(/abcdefghi|topsecret|longsecret|private-value/);
  });

  it('aggregates only available metrics and distinguishes reported, estimated, and unavailable outcomes', () => {
    const records: UsageRecord[] = [
      { id: '1', timestamp: '2026-08-27T10:00:00Z', providerConnection: 'one', model: 'a', task: 'task-1', agent: 'agent-1', inputTokens: 100, outputTokens: 50, cachedTokens: 20, reasoningTokens: 5, generationMs: 1_000, latencyMs: 1_200, tokensPerSecond: 50, providerReportedCostUsd: .01, billing: 'commercial', result: 'success' },
      { id: '2', timestamp: '2026-08-27T11:00:00Z', providerConnection: 'one', model: 'a', task: 'task-2', agent: 'agent-2', inputTokens: 200, outputTokens: 100, contextUtilized: 300, generationMs: 2_000, latencyMs: 2_500, tokensPerSecond: 50, estimatedCostUsd: .02, billing: 'commercial', result: 'failed' },
      { id: '3', timestamp: '2026-08-27T12:00:00Z', providerConnection: 'one', model: 'b', billing: 'unknown' },
    ];
    const value = aggregateProviderStatistics(records);
    expect(value).toMatchObject({ totalRequests: 3, successfulRequests: 1, failedRequests: 1, successRate: .5, inputTokens: 300, outputTokens: 150, totalTokens: 450, activeGenerationMs: 3_000, longestRequestMs: 2_500, averageLatencyMs: 1_850, mostUsedModel: 'a', providerReportedCostUsd: .01, estimatedCostUsd: .02, tasksServed: 2, agentInvocations: 2 });
  });
});

describe('restart and reconnect lifecycle', () => {
  it('executes lightweight restart, reconnect, view reload, owned-runtime, and full-window paths', async () => {
    const context = fakeContext(); const diagnostics = new ProviderDiagnosticsStore(context.globalState); const calls: string[] = [];
    const result = (ok: boolean): ConnectionTestResult => ({ ok, state: ok ? 'online' : 'offline', title: '', endpoint: '', summary: '', models: [], durationMs: 0, checkedAt: new Date().toISOString(), checks: [] });
    const connections = { profiles: () => [profile()], reconnectAll: async () => { calls.push('reconnect'); return [result(true)]; } };
    const views = { restartServices: async () => { calls.push('restart'); return 'Services restarted.'; }, restartOwnedLocalRuntimes: () => { calls.push('runtimes'); return 'No owned runtimes.'; }, reloadViews: () => { calls.push('views'); }, refreshConnections: async () => { calls.push('refresh-connections'); } };
    const lifecycle = new LgsLifecycleService(connections, diagnostics, views, () => calls.push('refresh-settings'), async () => { calls.push('window'); });
    expect(await lifecycle.run('restartServices')).toBe('Services restarted.'); expect(await lifecycle.run('reconnectProviders')).toContain('1 online');
    await lifecycle.run('restartLocalRuntimes'); await lifecycle.run('reloadViews'); await lifecycle.run('reloadWindow');
    expect(calls).toEqual(expect.arrayContaining(['restart', 'reconnect', 'refresh-connections', 'runtimes', 'views', 'window']));
    expect(diagnostics.activities(profile().id).filter(entry => entry.type === 'lifecycle')).toHaveLength(4);
  });
});
