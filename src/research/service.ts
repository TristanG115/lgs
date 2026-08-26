import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { DependencyCatalog } from './dependencies.js';
import { FileResearchStore } from './store.js';
import type { ResearchConfiguration, ResearchFinding, ResearchOperation, ResearchProvider, ResearchRequest, ResearchResult, ResearchSource, SourceAuthority } from './types.js';
import { ResearchProviderUnavailableError } from './provider.js';

const PRIORITY: Record<SourceAuthority, number> = {
  'official-documentation': 1, 'official-source': 2, 'official-maintainer-discussion': 3,
  'authoritative-reference': 4, community: 5, forum: 6
};

export class ResearchService {
  private readonly dependencies: DependencyCatalog;
  constructor(private readonly provider: ResearchProvider, private readonly store: FileResearchStore, private readonly configuration: ResearchConfiguration, workspaceRoot: string) {
    this.dependencies = new DependencyCatalog(workspaceRoot);
  }

  async research(request: ResearchRequest): Promise<ResearchResult> {
    if (!request.query.trim() || request.query.length > 4_000) throw new Error('Research query must contain 1 to 4000 characters.');
    const catalog = this.dependencies.read();
    const dependency = this.dependencies.resolve(request.dependency, request.query, catalog);
    const relevantVersion = request.relevantVersion?.trim() || dependency?.resolvedVersion || dependency?.declaredVersion;
    const researchedQuery = enrichQuery(request.operation, request.query.trim(), dependency?.name, relevantVersion, request.purpose);
    const queryKey = hash(`${request.operation}\0${normalize(researchedQuery)}\0${request.url ?? ''}`);
    const maximumAge = Math.min(Math.max(request.maxAgeDays ?? this.configuration.freshnessDays, 1), 365) * 86_400_000;
    const cached = this.store.reusable(request.taskId, queryKey, relevantVersion, maximumAge);
    if (cached.length) return { operation: request.operation, originalQuery: request.query, researchedQuery, dependency, findings: sortFindings(cached), reused: true };
    const sources = await this.invoke(request.operation, request.url ?? request.query, researchedQuery, request.signal);
    const retrievedAt = new Date().toISOString();
    const findings = sources.sort((left, right) => PRIORITY[left.authority] - PRIORITY[right.authority]).slice(0, this.configuration.maxResults).flatMap(source => {
      const finding = conciseFinding(source, request.purpose ?? request.query);
      if (!finding) return [];
      const normalizedUrl = normalizeUrl(source.url);
      return [{
        id: randomUUID(), operation: request.operation, sourceUrl: normalizedUrl, title: source.title.trim().slice(0, 300), retrievedAt,
        relevantVersion: source.relevantVersion ?? relevantVersion, finding, authority: source.authority, priority: PRIORITY[source.authority], task: request.taskId,
        subtask: request.subtask?.trim().slice(0, 500), requestingAgent: request.requestingAgent.slice(0, 128), query: researchedQuery, queryKey,
        dependency: dependency ? { ...dependency, manifestPaths: [...dependency.manifestPaths] } : undefined
      } satisfies ResearchFinding];
    });
    this.store.append(request.taskId, findings);
    return { operation: request.operation, originalQuery: request.query, researchedQuery, dependency, findings, reused: false };
  }

  private async invoke(operation: ResearchOperation, target: string, researchedQuery: string, signal?: AbortSignal): Promise<ResearchSource[]> {
    if (operation === 'web_fetch') return [await required(this.provider.webFetch, 'web_fetch').call(this.provider, target, signal)];
    if (operation === 'web_search') return required(this.provider.webSearch, operation).call(this.provider, researchedQuery, signal);
    if (operation === 'documentation_search') return required(this.provider.documentationSearch, operation).call(this.provider, researchedQuery, signal);
    return required(this.provider.repositorySearch, operation).call(this.provider, researchedQuery, signal);
  }
}

function required<T extends ((query: string, signal?: AbortSignal) => Promise<unknown>) | undefined>(method: T, operation: string): Exclude<T, undefined> { if (!method) throw new ResearchProviderUnavailableError(operation); return method as Exclude<T, undefined>; }
function enrichQuery(operation: ResearchOperation, query: string, dependency: string | undefined, version: string | undefined, purpose?: string): string {
  if (operation === 'web_fetch') return purpose ? `${query} — ${purpose.trim()}` : query;
  if (!dependency) return version && !normalize(query).includes(normalize(version)) ? `${query} ${version}` : query;
  if (!version) return normalize(query).includes(normalize(dependency)) ? query : `${dependency} ${query}`;
  const prefix = `${dependency} ${version}`;
  if (normalize(query).includes(normalize(prefix))) return query;
  const dependencyIndex = normalize(query).indexOf(normalize(dependency));
  return dependencyIndex >= 0 ? `${query.slice(0, dependencyIndex + dependency.length)} ${version}${query.slice(dependencyIndex + dependency.length)}` : `${prefix} ${query}`;
}
function conciseFinding(source: ResearchSource, purpose: string): string {
  const raw = source.snippet ?? source.content ?? '';
  if (!raw.trim()) return '';
  const text = stripMarkup(raw).replace(/\s+/g, ' ').trim();
  if (source.snippet) return text.slice(0, 1_500);
  const terms = [...new Set(purpose.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])];
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const ranked = sentences.map((sentence, index) => ({ sentence, index, score: terms.filter(term => sentence.toLowerCase().includes(term)).length }))
    .sort((left, right) => right.score - left.score || left.index - right.index).slice(0, 5).sort((left, right) => left.index - right.index).map(item => item.sentence);
  return ranked.join(' ').slice(0, 1_500);
}
function stripMarkup(value: string): string { return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>'); }
function normalize(value: string): string { return value.toLowerCase().replace(/\s+/g, ' ').trim(); }
function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function normalizeUrl(value: string): string { const url = new URL(value); url.hash = ''; return url.toString(); }
function sortFindings(values: ResearchFinding[]): ResearchFinding[] { return [...values].sort((left, right) => left.priority - right.priority || left.sourceUrl.localeCompare(right.sourceUrl)); }
