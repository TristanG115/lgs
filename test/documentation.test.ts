import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  COMPLETION_REQUIREMENTS, CompletionGuard, DocumentationAgent, FileCompletionEvidenceStore, FileDocumentationAuditStore,
  FileTaskStateStore, RuleBasedDocumentationAnalyzer, ToolExecutor, ToolRegistry, parseCompletionConfiguration,
  parseDocumentationAnalysis, registerDocumentationTools, type CompletionGateConfiguration, type DocumentationAnalyzer,
  type DocumentationContext
} from '../src/tools/index.js';
import { writeRepositoryIndex, type RepositoryIndex } from '../src/intelligence/indexer.js';

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lgs-documentation-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }));
  fs.writeFileSync(path.join(root, 'src', 'api.ts'), "import { value } from './value.js';\nexport interface PublicApi { ready: boolean }\nexport const api: PublicApi = { ready: value };\n");
  fs.writeFileSync(path.join(root, 'src', 'value.ts'), 'export const value = true;\n');
  fs.writeFileSync(path.join(root, 'README.md'), '# Fixture\n\nDeveloper guide.\n');
  writeRepositoryIndex(root);
  return root;
}
function cleanup(root: string): void { fs.rmSync(root, { recursive: true, force: true }); }
function task(root: string, recentModifications = ['src/api.ts']) {
  const state = new FileTaskStateStore(root); state.ensure('phase-13', 'Require documentation maintenance.');
  state.update('phase-13', { acceptanceCriteria: ['DocumentationAgent sees engineering context', 'Completion blocks stale docs'], currentPlan: ['Audit documentation'], completedWork: ['Changed public API'], remainingWork: ['Update docs'], recentModifications });
  return state;
}
function gates(...required: (typeof COMPLETION_REQUIREMENTS)[number][]): CompletionGateConfiguration {
  return Object.fromEntries(COMPLETION_REQUIREMENTS.map(requirement => [requirement, required.includes(requirement)])) as CompletionGateConfiguration;
}

describe('DocumentationAgent', () => {
  it('receives the objective, criteria, diff, symbols, relationships, docs, map, and task state', async () => {
    const root = fixture(); const state = task(root); let observed: DocumentationContext | undefined;
    const analyzer: DocumentationAnalyzer = { analyze: async context => {
      observed = context;
      return { summary: 'Audited.', assessments: ['user-facing', 'developer', 'architecture', 'configuration', 'api', 'inline-comments', 'codebase-map', 'task-records'].map(category => ({ category: category as never, status: 'current', reason: 'Current.', affectedFiles: [] })) };
    } };
    const store = new FileDocumentationAuditStore(root, state);
    await new DocumentationAgent(root, state, analyzer, store).audit('phase-13');
    expect(observed).toMatchObject({ objective: 'Require documentation maintenance.', acceptanceCriteria: ['DocumentationAgent sees engineering context', 'Completion blocks stale docs'], changedPaths: ['src/api.ts'], changedSymbols: [{ path: 'src/api.ts', symbols: ['PublicApi', 'api'] }], taskState: { revision: 1 } });
    expect(observed?.diff).toContain('not a Git repository');
    expect(observed?.repositoryRelationships).toContainEqual({ from: 'src/api.ts', to: 'src/value.ts' });
    expect(observed?.currentDocumentation[0]).toMatchObject({ path: 'README.md' });
    expect(observed?.codebaseMap).toContain('# LGS Codebase Map');
    cleanup(root);
  });

  it('classifies documentation categories without demanding obvious inline comments', async () => {
    const root = fixture(); const state = task(root); const store = new FileDocumentationAuditStore(root, state);
    const audit = await new DocumentationAgent(root, state, new RuleBasedDocumentationAnalyzer(), store).audit('phase-13');
    expect(audit.assessments.find(item => item.category === 'developer')?.status).toBe('stale');
    expect(audit.assessments.find(item => item.category === 'architecture')?.status).toBe('stale');
    expect(audit.assessments.find(item => item.category === 'inline-comments')).toMatchObject({ status: 'not-applicable' });
    expect(audit.assessments.find(item => item.category === 'codebase-map')?.status).toBe('current');
    cleanup(root);
  });

  it('mechanically blocks completion for missing, stale, and outdated documentation audits', async () => {
    const root = fixture(); const state = task(root); const store = new FileDocumentationAuditStore(root, state);
    const guard = new CompletionGuard(root, parseCompletionConfiguration({ gates: gates('documentation_current') }), new FileCompletionEvidenceStore(root), { read: () => [] }, store);
    expect(guard.evaluate('phase-13').outstanding[0]).toContain('has not run');
    const agent = new DocumentationAgent(root, state, new RuleBasedDocumentationAnalyzer(), store);
    await agent.audit('phase-13');
    expect(guard.evaluate('phase-13').outstanding[0]).toContain('user-facing');
    fs.appendFileSync(path.join(root, 'README.md'), '\n## Public API\n\nThe API exposes readiness.\n');
    state.update('phase-13', { completedWork: ['Changed public API', 'Updated README'], remainingWork: [], recentModifications: ['src/api.ts', 'README.md'] });
    const previous = JSON.parse(fs.readFileSync(path.join(root, '.lgs', 'index.json'), 'utf8')) as RepositoryIndex;
    writeRepositoryIndex(root, previous);
    await agent.audit('phase-13');
    expect(guard.evaluate('phase-13')).toMatchObject({ status: 'passed' });
    fs.appendFileSync(path.join(root, 'src', 'api.ts'), 'export const laterChange = true;\n');
    expect(guard.evaluate('phase-13').outstanding[0]).toContain('audit is stale');
    cleanup(root);
  });

  it('forces incremental CODEBASE_MAP maintenance after relevant source changes', async () => {
    const root = fixture(); const state = task(root); const store = new FileDocumentationAuditStore(root, state); const agent = new DocumentationAgent(root, state, new RuleBasedDocumentationAnalyzer(), store);
    fs.appendFileSync(path.join(root, 'src', 'api.ts'), 'export const changedResponsibility = true;\n');
    const audit = await agent.audit('phase-13');
    expect(audit.assessments.find(item => item.category === 'codebase-map')).toMatchObject({ status: 'stale' });
    expect(audit.assessments.find(item => item.category === 'api')).toMatchObject({ status: 'stale' });
    const previous = JSON.parse(fs.readFileSync(path.join(root, '.lgs', 'index.json'), 'utf8')) as RepositoryIndex;
    const updated = writeRepositoryIndex(root, previous);
    expect(updated.incremental.changed).toContain('src/api.ts');
    expect(store.isCurrent(audit)).toBe(false);
    cleanup(root);
  });

  it('validates structured model assessments and registers audit tools', async () => {
    const categories = ['user-facing', 'developer', 'architecture', 'configuration', 'api', 'inline-comments', 'codebase-map', 'task-records'];
    expect(parseDocumentationAnalysis(JSON.stringify({ summary: 'Current.', assessments: categories.map(category => ({ category, status: 'current', reason: 'Verified.', affectedFiles: [] })) })).assessments).toHaveLength(8);
    expect(() => parseDocumentationAnalysis(JSON.stringify({ summary: 'Incomplete.', assessments: [] }))).toThrow('every documentation category');
    const root = fixture(); const state = task(root); const store = new FileDocumentationAuditStore(root, state); const agent = new DocumentationAgent(root, state, new RuleBasedDocumentationAnalyzer(), store);
    const registry = registerDocumentationTools(new ToolRegistry(), agent, store);
    expect(registry.list().map(tool => tool.id)).toEqual(['audit_documentation', 'update_codebase_map', 'get_documentation_state']);
    const result = await new ToolExecutor(registry, root).execute({ id: 'audit_documentation', arguments: {} }, { taskId: 'phase-13', agentId: 'manager' });
    expect(result).toMatchObject({ status: 'success', metadata: { source: 'documentation', resultCount: 8 } });
    cleanup(root);
  });
});
