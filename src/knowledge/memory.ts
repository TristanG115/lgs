import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { MemoryConfiguration, MemoryKind, ProjectMemory } from './types.js';

export const DEFAULT_MEMORY_CONFIGURATION: MemoryConfiguration = { enabled: true, retentionDays: 180, maxEntries: 500, maxRetrievedTokens: 1_500 };

export class ProjectMemoryStore {
  private enabled: boolean;
  private configuration: MemoryConfiguration;
  constructor(private readonly root: string, configuration: MemoryConfiguration = DEFAULT_MEMORY_CONFIGURATION) { this.configuration = { ...configuration }; this.enabled = configuration.enabled; }

  setEnabled(enabled: boolean): void { this.enabled = enabled; }
  configureRetention(retentionDays: number, maxEntries: number): void { this.configuration = { ...this.configuration, retentionDays, maxEntries }; }
  remember(input: { kind: MemoryKind; content: string; tags?: string[] }): ProjectMemory {
    if (!this.enabled) throw new Error('Long-term memory is disabled.');
    const content = input.content.trim().slice(0, 8_000); if (!content) throw new Error('Memory content is required.');
    const now = new Date().toISOString(); const memory: ProjectMemory = { id: randomUUID(), kind: input.kind, content, tags: normalizeTags(input.tags ?? []), createdAt: now, updatedAt: now, lastAccessedAt: now, accessCount: 0 };
    this.write([...this.read(), memory]); return memory;
  }
  search(query: string, maximumTokens = this.configuration.maxRetrievedTokens): ProjectMemory[] {
    if (!this.enabled) return [];
    const terms = tokenize(query); let budget = Math.max(0, maximumTokens); const ranked = this.read().map(memory => ({ memory, score: score(memory, terms) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score || b.memory.updatedAt.localeCompare(a.memory.updatedAt));
    const selected = ranked.flatMap(({ memory }) => { const cost = estimateTokens(memory.content); if (cost > budget) return []; budget -= cost; return [memory]; });
    if (selected.length) { const accessed = new Set(selected.map(memory => memory.id)); this.write(this.read().map(memory => accessed.has(memory.id) ? { ...memory, lastAccessedAt: new Date().toISOString(), accessCount: memory.accessCount + 1 } : memory)); }
    return selected;
  }
  inspect(): { enabled: boolean; count: number; bytes: number; retentionDays: number; maxEntries: number } { const entries = this.read(); return { enabled: this.enabled, count: entries.length, bytes: Buffer.byteLength(JSON.stringify(entries)), retentionDays: this.configuration.retentionDays, maxEntries: this.configuration.maxEntries }; }
  delete(id: string): boolean { const entries = this.read(); const next = entries.filter(memory => memory.id !== id); if (next.length === entries.length) return false; this.write(next); return true; }
  compact(): { removed: number; count: number } { const entries = this.read(); const cutoff = Date.now() - this.configuration.retentionDays * 86_400_000; const fresh = entries.filter(memory => Date.parse(memory.updatedAt) >= cutoff).slice(-this.configuration.maxEntries); this.write(fresh); return { removed: entries.length - fresh.length, count: fresh.length }; }
  private read(): ProjectMemory[] { try { const value = JSON.parse(fs.readFileSync(this.file(), 'utf8')) as unknown; return Array.isArray(value) ? value.filter(valid) : []; } catch { return []; } }
  private write(entries: ProjectMemory[]): void { fs.mkdirSync(path.dirname(this.file()), { recursive: true }); fs.writeFileSync(this.file(), JSON.stringify(entries, null, 2) + '\n'); }
  private file(): string { return path.join(this.root, '.lgs', 'memory.json'); }
}
function valid(value: unknown): value is ProjectMemory { if (!value || typeof value !== 'object' || Array.isArray(value)) return false; const m = value as Record<string, unknown>; return typeof m.id === 'string' && typeof m.kind === 'string' && typeof m.content === 'string' && Array.isArray(m.tags) && typeof m.createdAt === 'string' && typeof m.updatedAt === 'string' && typeof m.lastAccessedAt === 'string' && typeof m.accessCount === 'number'; }
function normalizeTags(tags: string[]): string[] { return [...new Set(tags.map(tag => tag.trim().toLocaleLowerCase().slice(0, 80)).filter(Boolean))].slice(0, 20); }
function tokenize(value: string): string[] { return value.toLocaleLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? []; }
function score(memory: ProjectMemory, terms: string[]): number { const text = `${memory.kind} ${memory.tags.join(' ')} ${memory.content}`.toLocaleLowerCase(); return terms.reduce((total, term) => total + (text.includes(term) ? 1 : 0), 0); }
function estimateTokens(value: string): number { return Math.ceil(value.length / 4); }
