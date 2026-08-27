import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ContextBroker } from '../src/context/index.js';
import { indexRepository } from '../src/intelligence/indexer.js';
import { FilePricingStore, FileUsageStore, UsageTracker, parseUsageConfiguration } from '../src/usage/index.js';
import { FileTaskStateStore } from '../src/watchdog/state.js';

function fixture(): string { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lgs-context-')); fs.mkdirSync(path.join(root, 'src')); fs.mkdirSync(path.join(root, 'test')); fs.writeFileSync(path.join(root, 'src', 'auth.ts'), 'export function authenticate(token: string) {\n  return token.length > 0;\n}\n'); fs.writeFileSync(path.join(root, 'src', 'api.ts'), 'import { authenticate } from "./auth.js";\nexport function handle(token: string) { return authenticate(token); }\n'); fs.writeFileSync(path.join(root, 'test', 'api.test.ts'), 'import { handle } from "../src/api.js";\nit("handles token", () => handle("x"));\n'); return root; }
function cleanup(root: string): void { fs.rmSync(root, { recursive: true, force: true }); }

describe('Advanced Context Optimization', () => {
  it('retrieves hierarchy first, descends to requested symbols, deduplicates, and keeps required task evidence', () => {
    const root = fixture(); const broker = new ContextBroker(); const index = indexRepository(root); const candidates = broker.repositoryCandidates(root, index, { objective: 'Fix authenticate token handling', paths: ['src/auth.ts'], symbols: ['authenticate'] });
    candidates.push({ id: 'required-evidence', level: 'file', category: 'tools', content: 'Verification failed: api test must pass.', tokenCount: 40, required: true }, { id: 'duplicate-evidence', level: 'file', category: 'tools', content: 'Verification failed: api test must pass.', tokenCount: 40 });
    const selection = broker.select({ objective: 'Fix authenticate token handling', tokenBudget: 140, candidates, requestedPaths: ['src/auth.ts'], requestedSymbols: ['authenticate'] }, false);
    expect(candidates.some(item => item.level === 'directory')).toBe(true); expect(selection.selected.some(item => item.id === 'required-evidence')).toBe(true);
    expect(selection.selected.some(item => item.id === 'symbol:src/auth.ts:authenticate')).toBe(true);
    expect(selection.omitted).toContainEqual({ id: 'duplicate-evidence', reason: 'duplicate' });
    expect(selection.metrics.tokensSaved).toBeGreaterThan(0); expect(selection.metrics.categoryBreakdown.source).toBeGreaterThan(0);
    cleanup(root);
  });

  it('prefers task-relevant reverse dependencies and related tests over unrelated candidates within budget', () => {
    const broker = new ContextBroker(); const selection = broker.select({ objective: 'Repair auth API tests', tokenBudget: 70, candidates: [
      { id: 'unrelated', level: 'file', category: 'source', content: 'theme colors typography', tokenCount: 60 },
      { id: 'relevant', level: 'file', category: 'source', content: 'auth API token handling', tokenCount: 50, reverseDependencies: ['src/api.ts'], relatedTests: ['test/api.test.ts'] }
    ] }, false);
    expect(selection.selected.map(item => item.id)).toEqual(['relevant']); expect(selection.metrics.savings.tokensAvoided).toBe(60);
  });

  it('records selection savings for the next observed request and compacts durable task facts without losing evidence', () => {
    const root = fixture(); const broker = new ContextBroker(); broker.select({ objective: 'Fix auth', tokenBudget: 10, candidates: [{ id: 'evidence', level: 'file', category: 'tools', content: 'Test failure evidence', tokenCount: 8, required: true }, { id: 'candidate', level: 'file', category: 'source', content: 'unrelated source', tokenCount: 80 }] });
    const tracker = new UsageTracker(new FileUsageStore(root), new FilePricingStore(root), parseUsageConfiguration()); const measurement = tracker.begin({ providerConnection: 'local', model: 'small', billing: 'local' }); measurement.observe({ type: 'usage', usage: { inputTokens: 8 } }); const usage = measurement.finish()!;
    expect(usage.contextSavings).toMatchObject({ rawCandidateTokens: 88, selectedTokens: 8, tokensAvoided: 80 }); expect(usage.contextBreakdown).toMatchObject({ tools: 8 });
    const state = new FileTaskStateStore(root); state.ensure('context-23', 'Optimize context'); state.update('context-23', { verifiedFacts: ['Index confirms reverse dependency.'], designDecisions: ['Use retrieval before summarization.'], failedApproaches: ['Do not summarize all files.'], blockers: ['Need provider token counts.'] });
    const reloaded = new FileTaskStateStore(root); expect(reloaded.read('context-23')).toMatchObject({ verifiedFacts: ['Index confirms reverse dependency.'], designDecisions: ['Use retrieval before summarization.'], failedApproaches: ['Do not summarize all files.'], blockers: ['Need provider token counts.'] }); expect(reloaded.compactSummary('context-23')).toContain('Failed approaches: Do not summarize all files.');
    cleanup(root);
  });
});
