import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RepositoryIndex } from '../intelligence/indexer.js';
import { setActiveContextMetrics } from '../usage/runtime.js';
import type { ContextCandidate, ContextRequest, ContextSelection } from './types.js';

const LEVEL_SCORE = { repository: 2, module: 4, directory: 6, file: 8, symbol: 10, 'source-range': 12 } as const;

/** Retrieval-first selector. It never rewrites source; it chooses compact hierarchy metadata or exact source ranges. */
export class ContextBroker {
  select(request: ContextRequest, activateForNextRequest = true): ContextSelection {
    const terms = termsOf(request.objective); const paths = new Set(request.requestedPaths ?? []); const symbols = new Set(request.requestedSymbols ?? []);
    const deduplicated = new Map<string, ContextCandidate>(); const omitted: ContextSelection['omitted'] = [];
    for (const candidate of request.candidates) {
      const key = candidate.dedupKey ?? `${candidate.category}\0${candidate.content}`;
      if (deduplicated.has(key)) { omitted.push({ id: candidate.id, reason: 'duplicate' }); continue; }
      deduplicated.set(key, candidate);
    }
    const ranked = [...deduplicated.values()].map(candidate => ({ ...candidate, estimatedTokens: candidate.tokenCount ?? estimateTokens(candidate.content), score: score(candidate, terms, paths, symbols) })).sort((a, b) => Number(b.required) - Number(a.required) || b.score - a.score || a.estimatedTokens - b.estimatedTokens || a.id.localeCompare(b.id));
    let remaining = Math.max(0, Math.floor(request.tokenBudget)); const selected: ContextSelection['selected'] = [];
    for (const item of ranked) {
      if (item.required || item.estimatedTokens <= remaining) { selected.push(item); remaining = Math.max(0, remaining - item.estimatedTokens); }
      else omitted.push({ id: item.id, reason: selected.length ? 'budget' : 'lower-relevance' });
    }
    const candidateTokens = ranked.reduce((sum, item) => sum + item.estimatedTokens, 0); const selectedTokens = selected.reduce((sum, item) => sum + item.estimatedTokens, 0); const tokensSaved = Math.max(0, candidateTokens - selectedTokens); const categoryBreakdown = Object.fromEntries(selected.map(item => [item.category, (categoryBreakdownFor(selected, item.category))])) as ContextSelection['metrics']['categoryBreakdown'];
    const metrics = { candidateTokens, selectedTokens, tokensSaved, savingsPercentage: candidateTokens ? rounded(tokensSaved / candidateTokens * 100) : 0, categoryBreakdown, savings: { rawCandidateTokens: candidateTokens, selectedTokens, tokensAvoided: tokensSaved, reductionPercent: candidateTokens ? rounded(tokensSaved / candidateTokens * 100) : 0 } };
    const selection = { selected, omitted, metrics };
    if (activateForNextRequest) setActiveContextMetrics({ contextUtilized: selectedTokens, contextBreakdown: categoryBreakdown, contextSavings: metrics.savings });
    return selection;
  }

  repositoryCandidates(root: string, index: RepositoryIndex, request: { objective: string; paths?: string[]; symbols?: string[] }): ContextCandidate[] {
    const candidates: ContextCandidate[] = [{ id: 'repository', level: 'repository', category: 'codebaseMap', content: `Repository: ${index.files.length} files; modules: ${index.hierarchy.modules.map(module => module.name).join(', ')}; entry points: ${index.entryPoints.join(', ') || 'none'}.`, dedupKey: 'repository' }];
    for (const module of index.hierarchy.modules) candidates.push({ id: `module:${module.id}`, level: 'module', category: 'codebaseMap', path: module.path || '.', content: `Module ${module.name}: ${module.files.length} files; directories: ${module.directories.join(', ')}; entry points: ${module.entryPoints.join(', ') || 'none'}.` });
    for (const directory of index.directories) { const files = index.files.filter(file => file.directory === directory); candidates.push({ id: `directory:${directory}`, level: 'directory', category: 'codebaseMap', path: directory, content: `Directory ${directory}: ${files.length} files; symbols: ${files.flatMap(file => file.symbols).slice(0, 20).join(', ') || 'none'}.` }); }
    const requestedPaths = new Set(request.paths ?? []); const requestedSymbols = new Set(request.symbols ?? []);
    for (const file of index.files) {
      const requested = requestedPaths.has(file.path); const symbolRequested = file.symbols.some(symbol => requestedSymbols.has(symbol));
      const relatedTests = index.files.filter(test => test.likelyTest && (test.path.includes(file.directory) || test.imports.some(value => value.includes(path.posix.basename(file.path, path.posix.extname(file.path)))))).map(test => test.path).slice(0, 8);
      candidates.push({ id: `file:${file.path}`, level: 'file', category: 'source', path: file.path, content: `File ${file.path}; symbols: ${file.symbols.join(', ') || 'none'}; imports: ${file.imports.join(', ') || 'none'}; imported by: ${(index.reverseDependencies[file.path] ?? []).join(', ') || 'none'}; related tests: ${relatedTests.join(', ') || 'none'}.`, imports: file.imports, reverseDependencies: index.reverseDependencies[file.path], relatedTests, agentRequested: requested, dedupKey: `file-meta:${file.path}` });
      if (!requested && !symbolRequested) continue;
      const source = readSource(root, file.path); if (!source) continue;
      if (symbolRequested) for (const symbol of file.symbols.filter(value => requestedSymbols.has(value))) { const range = symbolRange(source, symbol); if (range) candidates.push({ id: `symbol:${file.path}:${symbol}`, level: 'symbol', category: 'source', path: file.path, symbol, range: range.range, content: range.content, agentRequested: true, dedupKey: `source:${file.path}:${range.range.startLine}-${range.range.endLine}` }); }
      if (requested) candidates.push({ id: `source:${file.path}`, level: 'source-range', category: 'source', path: file.path, range: { startLine: 1, endLine: Math.min(source.split(/\r?\n/).length, 400) }, content: source.slice(0, 48_000), agentRequested: true, dedupKey: `source:${file.path}:1` });
    }
    return candidates;
  }
}

function score(candidate: ContextCandidate, terms: string[], paths: Set<string>, symbols: Set<string>): number { const searchable = `${candidate.path ?? ''} ${candidate.symbol ?? ''} ${candidate.content}`.toLocaleLowerCase(); const relevance = terms.reduce((sum, term) => sum + (searchable.includes(term) ? 8 : 0), 0); const requested = candidate.agentRequested || paths.has(candidate.path ?? '') || symbols.has(candidate.symbol ?? '') ? 40 : 0; return LEVEL_SCORE[candidate.level] + relevance + requested + (candidate.imports?.length ?? 0) * .5 + (candidate.reverseDependencies?.length ?? 0) * 2 + (candidate.relatedTests?.length ?? 0) * 2 + bounded(candidate.gitRelevance) * 5 + bounded(candidate.researchRelevance) * 5 + bounded(candidate.semanticRelevance) * 8; }
function categoryBreakdownFor(selected: ContextSelection['selected'], category: ContextCandidate['category']): number { return selected.filter(item => item.category === category).reduce((sum, item) => sum + item.estimatedTokens, 0); }
function termsOf(value: string): string[] { return [...new Set(value.toLocaleLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? [])]; }
function estimateTokens(value: string): number { return Math.ceil(value.length / 4); }
function bounded(value: number | undefined): number { return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0; }
function rounded(value: number): number { return Math.round(value * 100) / 100; }
function readSource(root: string, relative: string): string | undefined { try { return fs.readFileSync(path.join(root, relative), 'utf8'); } catch { return; } }
function symbolRange(source: string, symbol: string): { range: { startLine: number; endLine: number }; content: string } | undefined { const lines = source.split(/\r?\n/); const index = lines.findIndex(line => new RegExp(`\\b${escapeRegExp(symbol)}\\b`).test(line)); if (index < 0) return; const end = Math.min(lines.length, index + 200); return { range: { startLine: index + 1, endLine: end }, content: lines.slice(index, end).join('\n') }; }
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
