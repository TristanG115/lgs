import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BenchmarkRecord, LocalModelMetrics, LocalRuntimeKind, LocalRuntimeRecord } from './types.js';

const CANDIDATES: { kind: LocalRuntimeKind; url: string; models: string }[] = [
  { kind: 'ollama', url: 'http://127.0.0.1:11434', models: '/api/tags' },
  { kind: 'lm-studio', url: 'http://127.0.0.1:1234/v1', models: '/models' },
  { kind: 'llama-cpp', url: 'http://127.0.0.1:8080/v1', models: '/models' }
];
export class LocalRuntimeDiscovery {
  async discover(configured: string[] = [], signal?: AbortSignal): Promise<LocalRuntimeRecord[]> { return Promise.all([...CANDIDATES, ...configured.map((url, index) => ({ kind: 'openai-compatible' as const, url, models: '/models', id: `configured-${index}` }))].map(candidate => this.inspect(candidate.kind, candidate.url, candidate.models, signal))); }
  async inspect(kind: LocalRuntimeKind, baseUrl: string, modelsPath: string, signal?: AbortSignal): Promise<LocalRuntimeRecord> { const checkedAt = new Date().toISOString(); try { const response = await fetch(baseUrl.replace(/\/$/, '') + modelsPath, { signal }); if (!response.ok) throw new Error(`HTTP ${response.status}`); const body = await response.json() as Record<string, unknown>; const raw = kind === 'ollama' ? body.models : body.data; const models = Array.isArray(raw) ? raw.flatMap(item => typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>)[kind === 'ollama' ? 'name' : 'id'] === 'string' ? [(item as Record<string, unknown>)[kind === 'ollama' ? 'name' : 'id'] as string] : []) : []; return { id: `${kind}:${baseUrl}`, kind, baseUrl, status: 'healthy', models, loadedModels: [], capabilities: ['model-discovery', 'chat'], ownedByLgs: false, checkedAt }; } catch (error) { return { id: `${kind}:${baseUrl}`, kind, baseUrl, status: 'unreachable', models: [], loadedModels: [], capabilities: [], ownedByLgs: false, checkedAt, error: error instanceof Error ? error.message : 'Unreachable.' }; } }
}
export class BenchmarkStore {
  constructor(private readonly root: string) {}
  append(input: Omit<BenchmarkRecord, 'id'|'recordedAt'>): BenchmarkRecord { const record = { ...input, id: randomUUID(), recordedAt: new Date().toISOString() }; const all = [...this.read(), record].slice(-1000); fs.mkdirSync(path.dirname(this.file()), { recursive: true }); fs.writeFileSync(this.file(), JSON.stringify(all, null, 2) + '\n'); return record; }
  read(): BenchmarkRecord[] { try { const value = JSON.parse(fs.readFileSync(this.file(), 'utf8')) as unknown; return Array.isArray(value) ? value.filter(valid) : []; } catch { return []; } }
  private file(): string { return path.join(this.root, '.lgs', 'benchmarks.json'); }
}
export function metrics(startedAt: number, usage: { inputTokens?: number; outputTokens?: number }, contextSize?: number): LocalModelMetrics { const totalLatencyMs = Math.max(0, performance.now() - startedAt); const outputTokens = usage.outputTokens; return { promptTokens: usage.inputTokens, outputTokens, totalLatencyMs, generationMs: totalLatencyMs, tokensPerSecond: outputTokens && totalLatencyMs ? outputTokens / (totalLatencyMs / 1000) : undefined, contextSize, contextUtilization: contextSize && usage.inputTokens ? usage.inputTokens / contextSize : undefined }; }
function valid(value: unknown): value is BenchmarkRecord { return typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>).id === 'string' && typeof (value as Record<string, unknown>).model === 'string'; }
