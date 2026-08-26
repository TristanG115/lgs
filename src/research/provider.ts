import type { ResearchConfiguration, ResearchProvider, ResearchSource, SourceAuthority } from './types.js';

type FetchLike = typeof fetch;

export class ResearchProviderUnavailableError extends Error {
  constructor(operation: string) { super(`No research provider is configured for ${operation}.`); this.name = 'ResearchProviderUnavailableError'; }
}

export class HttpResearchProvider implements ResearchProvider {
  readonly id = 'http-research';
  constructor(private readonly configuration: ResearchConfiguration, private readonly fetcher: FetchLike = fetch) {}

  webSearch(query: string, signal?: AbortSignal): Promise<ResearchSource[]> { return this.endpointSearch('webSearch', query, signal); }
  documentationSearch(query: string, signal?: AbortSignal): Promise<ResearchSource[]> { return this.endpointSearch('documentationSearch', query, signal); }
  repositorySearch(query: string, signal?: AbortSignal): Promise<ResearchSource[]> {
    if (this.configuration.endpoints.repositorySearch) return this.endpointSearch('repositorySearch', query, signal);
    if (!this.configuration.github.enabled) throw new ResearchProviderUnavailableError('repository_search');
    return this.githubCodeSearch(query, signal);
  }

  async webFetch(url: string, signal?: AbortSignal): Promise<ResearchSource> {
    validatePublicUrl(url);
    const response = await this.request(url, signal, { Accept: 'text/html, text/plain, application/json, application/xml;q=0.8' });
    validatePublicUrl(response.url || url);
    if (!response.ok) throw new Error(`Research fetch failed with HTTP ${response.status}.`);
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType && !/(text|json|xml|javascript)/.test(contentType)) throw new Error(`Research fetch rejected unsupported content type: ${contentType}.`);
    const content = await boundedBody(response, this.configuration.maxFetchBytes);
    return { url: response.url || url, title: titleFromContent(content, response.url || url), content, authority: authorityFor(response.url || url) };
  }

  private async endpointSearch(kind: keyof ResearchConfiguration['endpoints'], query: string, signal?: AbortSignal): Promise<ResearchSource[]> {
    const endpoint = this.configuration.endpoints[kind];
    if (!endpoint) throw new ResearchProviderUnavailableError(kind);
    const url = endpoint.includes('{query}') ? endpoint.replaceAll('{query}', encodeURIComponent(query)) : appendQuery(endpoint, query);
    validatePublicUrl(url);
    const response = await this.request(url, signal, { Accept: 'application/json' });
    if (!response.ok) throw new Error(`Research search failed with HTTP ${response.status}.`);
    const value = await response.json() as unknown;
    const items = arrayResults(value);
    return items.flatMap(item => normalizeSearchItem(item, kind)).slice(0, this.configuration.maxResults);
  }

  private async githubCodeSearch(query: string, signal?: AbortSignal): Promise<ResearchSource[]> {
    const url = `${this.configuration.github.apiBaseUrl}/search/code?q=${encodeURIComponent(query)}&per_page=${this.configuration.maxResults}`;
    validatePublicUrl(url);
    const response = await this.request(url, signal, { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
    if (!response.ok) throw new Error(`GitHub source search failed with HTTP ${response.status}. Configure a repositorySearch endpoint if authenticated search is required.`);
    const value = await response.json() as unknown;
    const items = record(value) && Array.isArray(value.items) ? value.items : [];
    return items.flatMap(item => {
      if (!record(item) || typeof item.html_url !== 'string') return [];
      const repository = record(item.repository) && typeof item.repository.full_name === 'string' ? item.repository.full_name : 'GitHub repository';
      const sourcePath = typeof item.path === 'string' ? item.path : typeof item.name === 'string' ? item.name : 'source result';
      return [{ url: item.html_url, title: `${repository}: ${sourcePath}`, snippet: `Official source search matched ${sourcePath} in ${repository}.`, authority: 'official-source' as const }];
    });
  }

  private async request(url: string, signal: AbortSignal | undefined, headers: Record<string, string>): Promise<Response> {
    const controller = new AbortController();
    const onAbort = () => controller.abort(); signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      let current = url;
      for (let redirects = 0; redirects <= 5; redirects += 1) {
        validatePublicUrl(current);
        const response = await this.fetcher(current, { method: 'GET', headers: { ...headers, 'User-Agent': 'LGS-Research/1.0' }, redirect: 'manual', signal: controller.signal });
        if (![301, 302, 303, 307, 308].includes(response.status)) return response;
        if (redirects === 5) throw new Error('Research request exceeded the redirect limit.');
        const location = response.headers.get('location');
        if (!location) throw new Error('Research redirect did not include a location.');
        current = new URL(location, current).toString();
      }
      throw new Error('Research request exceeded the redirect limit.');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
  }
}

function normalizeSearchItem(value: unknown, kind: string): ResearchSource[] {
  if (!record(value)) return [];
  const url = string(value.url) ?? string(value.link) ?? string(value.html_url);
  if (!url || !/^https?:\/\//i.test(url)) return [];
  const title = string(value.title) ?? string(value.name) ?? url;
  const snippet = string(value.snippet) ?? string(value.description) ?? string(value.text);
  const supplied = string(value.authority);
  const authority = supplied && ['official-documentation', 'official-source', 'official-maintainer-discussion', 'authoritative-reference', 'community', 'forum'].includes(supplied)
    ? supplied as SourceAuthority : kind === 'documentationSearch' ? 'official-documentation' : authorityFor(url);
  return [{ url, title, snippet, authority, relevantVersion: string(value.relevantVersion) }];
}
function arrayResults(value: unknown): unknown[] { if (Array.isArray(value)) return value; if (!record(value)) return []; return Array.isArray(value.results) ? value.results : Array.isArray(value.items) ? value.items : []; }
function appendQuery(endpoint: string, query: string): string { const url = new URL(endpoint); url.searchParams.set('q', query); return url.toString(); }
function authorityFor(url: string): SourceAuthority {
  const hostname = new URL(url).hostname.toLowerCase();
  if (hostname === 'docs.github.com' || hostname.startsWith('developer.') || hostname.startsWith('docs.')) return 'official-documentation';
  if (hostname === 'github.com') return /\/issues\//.test(url) ? 'official-maintainer-discussion' : 'official-source';
  if (hostname.includes('stackoverflow.com') || hostname.includes('stackexchange.com') || hostname.includes('reddit.com')) return 'forum';
  return 'authoritative-reference';
}
function validatePublicUrl(value: string): void {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Research URLs must use HTTP(S) without embedded credentials.');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0' || host === '::1' || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) throw new Error('Research URLs cannot target local or private network hosts.');
}
async function boundedBody(response: Response, maximum: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let bytes = 0, output = '';
  try {
    while (true) { const item = await reader.read(); if (item.done) break; bytes += item.value.byteLength; if (bytes > maximum) { output += decoder.decode(item.value.subarray(0, Math.max(0, item.value.byteLength - (bytes - maximum))), { stream: true }); break; } output += decoder.decode(item.value, { stream: true }); }
    output += decoder.decode(); return output;
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
function titleFromContent(content: string, fallback: string): string { return content.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1].replace(/\s+/g, ' ').trim().slice(0, 300) || fallback; }
function string(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
