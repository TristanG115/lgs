import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DependencyCatalog, FileResearchStore, HttpResearchProvider, ResearchService, ToolExecutor, ToolRegistry,
  createWorkspaceToolRegistry, parseResearchConfiguration, registerResearchTools, type ResearchProvider, type ResearchSource
} from '../src/tools/index.js';

function fixture(version = '2.9.1'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lgs-research-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { yaml: '^2.9.0' } }));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': { dependencies: { yaml: '^2.9.0' } }, 'node_modules/yaml': { version } } }));
  return root;
}
function cleanup(root: string): void { fs.rmSync(root, { recursive: true, force: true }); }

class FakeProvider implements ResearchProvider {
  readonly id = 'fake'; calls: { operation: string; query: string }[] = [];
  constructor(private readonly sources: ResearchSource[]) {}
  async webSearch(query: string) { this.calls.push({ operation: 'web_search', query }); return this.sources; }
  async documentationSearch(query: string) { this.calls.push({ operation: 'documentation_search', query }); return this.sources; }
  async repositorySearch(query: string) { this.calls.push({ operation: 'repository_search', query }); return this.sources; }
  async webFetch(url: string) { this.calls.push({ operation: 'web_fetch', query: url }); return this.sources[0]; }
}

describe('research-first external knowledge', () => {
  it('reads manifests and lockfiles and enriches technical queries with exact dependency versions', async () => {
    const root = fixture();
    expect(new DependencyCatalog(root).resolve('yaml', 'parse API')).toMatchObject({ name: 'yaml', declaredVersion: '^2.9.0', resolvedVersion: '2.9.1', manifestPaths: ['package-lock.json', 'package.json'] });
    const provider = new FakeProvider([{ url: 'https://yaml.org/spec/', title: 'YAML specification', snippet: 'The parse API behavior is documented here.', authority: 'official-documentation' }]);
    const service = new ResearchService(provider, new FileResearchStore(root), parseResearchConfiguration(), root);
    const result = await service.research({ operation: 'documentation_search', query: 'yaml parse API behavior', taskId: 'task-12', requestingAgent: 'manager' });
    expect(result.researchedQuery).toBe('yaml 2.9.1 parse API behavior');
    expect(provider.calls[0].query).toContain('yaml 2.9.1');
    expect(result.dependency?.resolvedVersion).toBe('2.9.1');
    cleanup(root);
  });

  it('prioritizes official sources and stores complete provenance without page dumps', async () => {
    const root = fixture();
    const provider = new FakeProvider([
      { url: 'https://stackoverflow.com/questions/1', title: 'Forum answer', snippet: 'Community workaround.', authority: 'forum' },
      { url: 'https://docs.example.com/api', title: 'Official API', snippet: 'The supported API returns a parsed document.', authority: 'official-documentation' }
    ]);
    const store = new FileResearchStore(root); const service = new ResearchService(provider, store, parseResearchConfiguration(), root);
    const result = await service.research({ operation: 'web_search', query: 'yaml API return value', taskId: 'task-12', subtask: 'Confirm parser behavior', requestingAgent: 'agent-1', dependency: 'yaml' });
    expect(result.findings.map(finding => finding.authority)).toEqual(['official-documentation', 'forum']);
    expect(result.findings[0]).toMatchObject({ sourceUrl: 'https://docs.example.com/api', title: 'Official API', relevantVersion: '2.9.1', task: 'task-12', subtask: 'Confirm parser behavior', requestingAgent: 'agent-1', priority: 1 });
    expect(store.read('task-12')).toHaveLength(2);
    expect(JSON.stringify(store.read('task-12'))).not.toContain('<html');
    cleanup(root);
  });

  it('deduplicates fresh task research and refreshes it when the dependency version changes', async () => {
    const root = fixture(); const provider = new FakeProvider([{ url: 'https://docs.example.com/yaml', title: 'Docs', snippet: 'Versioned behavior.', authority: 'official-documentation' }]);
    const service = new ResearchService(provider, new FileResearchStore(root), parseResearchConfiguration(), root);
    const request = { operation: 'documentation_search' as const, query: 'yaml parser behavior', taskId: 'task-12', requestingAgent: 'manager' };
    expect((await service.research(request)).reused).toBe(false);
    expect((await service.research({ ...request, requestingAgent: 'reviewer' })).reused).toBe(true);
    expect(provider.calls).toHaveLength(1);
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': { dependencies: { yaml: '^2.9.0' } }, 'node_modules/yaml': { version: '2.10.0' } } }));
    expect((await service.research(request)).reused).toBe(false);
    expect(provider.calls).toHaveLength(2);
    cleanup(root);
  });

  it('honors explicit non-dependency versions and provider version provenance', async () => {
    const root = fixture(); const provider = new FakeProvider([{ url: 'https://api.example.com/v16', title: 'API docs', snippet: 'Version-specific behavior.', authority: 'official-documentation', relevantVersion: '16.2' }]);
    const service = new ResearchService(provider, new FileResearchStore(root), parseResearchConfiguration(), root);
    const result = await service.research({ operation: 'web_search', query: 'Example API middleware behavior', relevantVersion: '16.2', taskId: 'task-12', requestingAgent: 'manager' });
    expect(result.researchedQuery).toBe('Example API middleware behavior 16.2');
    expect(result.findings[0].relevantVersion).toBe('16.2');
    expect((await service.research({ operation: 'web_search', query: 'Example API middleware behavior', relevantVersion: '16.2', taskId: 'task-12', requestingAgent: 'reviewer' })).reused).toBe(true);
    cleanup(root);
  });

  it('extracts concise purpose-relevant evidence from fetched pages', async () => {
    const root = fixture(); const irrelevant = Array.from({ length: 100 }, (_, index) => `Navigation item ${index}.`).join(' ');
    const provider = new FakeProvider([{ url: 'https://docs.example.com/page', title: 'Long page', content: `<html><script>secret transcript</script><body>${irrelevant} The cancellation API accepts an AbortSignal and stops pending work. ${irrelevant}</body></html>`, authority: 'official-documentation' }]);
    const result = await new ResearchService(provider, new FileResearchStore(root), parseResearchConfiguration(), root).research({ operation: 'web_fetch', query: 'https://docs.example.com/page', url: 'https://docs.example.com/page', purpose: 'cancellation AbortSignal', taskId: 'task-12', requestingAgent: 'researcher' });
    expect(result.findings[0].finding).toContain('AbortSignal');
    expect(result.findings[0].finding.length).toBeLessThanOrEqual(1500);
    expect(result.findings[0].finding).not.toContain('secret transcript');
    cleanup(root);
  });

  it('registers all provider-neutral research tools and reuses findings through tool calls', async () => {
    const root = fixture(); const provider = new FakeProvider([{ url: 'https://docs.example.com/api', title: 'Docs', snippet: 'Concise evidence.', authority: 'official-documentation' }]);
    const store = new FileResearchStore(root); const service = new ResearchService(provider, store, parseResearchConfiguration(), root);
    const registry = registerResearchTools(new ToolRegistry(), service, store);
    expect(registry.list().map(tool => tool.id)).toEqual(['web_search', 'documentation_search', 'web_fetch', 'repository_search', 'get_research_findings']);
    expect(registry.list().slice(0, 4).every(tool => tool.permission.network && tool.permission.category === 'network')).toBe(true);
    const executor = new ToolExecutor(registry, root);
    const first = await executor.execute({ id: 'documentation_search', arguments: { query: 'yaml parse behavior' } }, { taskId: 'task-12', agentId: 'manager' });
    const second = await executor.execute({ id: 'documentation_search', arguments: { query: 'yaml parse behavior' } }, { taskId: 'task-12', agentId: 'reviewer' });
    expect(first.status).toBe('success'); expect(second.data).toMatchObject({ reused: true }); expect(provider.calls).toHaveLength(1);
    cleanup(root);
  });

  it('supports specialized GitHub source search and rejects private fetch targets', async () => {
    const root = fixture(); const requests: string[] = [];
    const fetcher: typeof fetch = async input => {
      requests.push(String(input));
      return new Response(JSON.stringify({ items: [{ html_url: 'https://github.com/org/repo/blob/main/src/api.ts', path: 'src/api.ts', repository: { full_name: 'org/repo' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const provider = new HttpResearchProvider(parseResearchConfiguration(), fetcher);
    expect(await provider.repositorySearch('AbortSignal repo:org/repo')).toMatchObject([{ authority: 'official-source', title: 'org/repo: src/api.ts' }]);
    expect(requests[0]).toContain('api.github.com/search/code');
    await expect(provider.webFetch('http://127.0.0.1/private')).rejects.toThrow('local or private');
    const redirecting: typeof fetch = async () => new Response(null, { status: 302, headers: { location: 'http://10.0.0.1/private' } });
    await expect(new HttpResearchProvider(parseResearchConfiguration(), redirecting).webFetch('https://docs.example.com/start')).rejects.toThrow('local or private');
    const errors: string[] = [];
    parseResearchConfiguration({ endpoints: { webSearch: 'https://user:secret@example.com/search' } }, errors);
    expect(errors).toContain('Invalid research endpoint: webSearch.');
    cleanup(root);
  });

  it('keeps research optional when constructing a workspace registry', () => {
    expect(createWorkspaceToolRegistry().list().some(tool => tool.id === 'web_search')).toBe(false);
  });
});
