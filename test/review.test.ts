import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  COMPLETION_REQUIREMENTS, CompletionGuard, FileCompletionEvidenceStore, FileDocumentationAuditStore, FileResearchStore,
  FileReviewStore, FileTaskEvidenceStore, FileTaskStateStore, IndependentReviewer, ToolExecutor, ToolRegistry,
  detectEscalationTriggers, parseCompletionConfiguration, parseReviewAnalysis, registerReviewTools,
  type CompletionGateConfiguration, type ExecutionResult, type GitBaseline, type ReviewContext, type ReviewerAnalyzer, type ReviewFinding, type ToolResult
} from '../src/tools/index.js';
import { writeRepositoryIndex } from '../src/intelligence/indexer.js';

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lgs-review-'));
  fs.mkdirSync(path.join(root, 'src')); fs.mkdirSync(path.join(root, 'test'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'review-fixture', version: '1.0.0' }));
  fs.writeFileSync(path.join(root, 'src', 'main.ts'), 'export const calculate = (value: number) => value + 1;\n');
  fs.writeFileSync(path.join(root, 'test', 'main.test.ts'), 'it("calculates", () => expect(2).toBe(2));\n');
  fs.writeFileSync(path.join(root, 'README.md'), '# Review fixture\n\nThe calculation API increments input.\n');
  writeRepositoryIndex(root); return root;
}
function cleanup(root: string): void { fs.rmSync(root, { recursive: true, force: true }); }
function setup(root: string) {
  const state = new FileTaskStateStore(root); state.ensure('phase-14', 'Implement independent review without sharing the implementation conversation.');
  state.update('phase-14', { acceptanceCriteria: ['Fresh review context', 'Structured findings', 'Completion approval'], currentPlan: ['Review current evidence'], completedWork: ['Implemented change'], remainingWork: [], recentModifications: ['src/main.ts', 'test/main.test.ts', 'README.md'] });
  const executions = new FileTaskEvidenceStore(root); executions.recordExecution('phase-14', execution());
  const research = new FileResearchStore(root); research.append('phase-14', [{ id: 'research-1', operation: 'documentation_search', sourceUrl: 'https://docs.example.com/api', title: 'Official API', retrievedAt: new Date().toISOString(), relevantVersion: '1.0', finding: 'The API accepts numbers.', authority: 'official-documentation', priority: 1, task: 'phase-14', requestingAgent: 'manager', query: 'API 1.0', queryKey: 'key' }]);
  const documentation = new FileDocumentationAuditStore(root, state);
  const reviews = new FileReviewStore(root, documentation, executions, research);
  return { state, executions, research, documentation, reviews };
}
function execution(): ExecutionResult {
  const now = new Date().toISOString();
  return { id: 'test-pass', request: { executable: 'npm', args: ['test'], category: 'test', envKeys: [], verificationStep: 'test' }, status: 'passed', startedAt: now, completedAt: now, durationMs: 1, exitCode: 0, signal: null, timedOut: false, normalized: { command: 'npm test', exitCode: 0, relevantStack: [], fileLocations: [], stdout: ['75 tests passed'], stderr: [], omittedLineCount: 0 } };
}
function finding(): ReviewFinding { return { id: 'finding-1', severity: 'high', confidence: 'high', location: 'src/main.ts:1', description: 'Negative values are not covered.', evidence: 'The implementation accepts every number but tests only exercise a positive value.', recommendedAction: 'Add a negative-value behavior test.' }; }
function gates(...required: (typeof COMPLETION_REQUIREMENTS)[number][]): CompletionGateConfiguration { return Object.fromEntries(COMPLETION_REQUIREMENTS.map(item => [item, required.includes(item)])) as CompletionGateConfiguration; }
function baseline(root: string): GitBaseline { return { version: 1, capturedAt: new Date().toISOString(), workspaceRoot: root, repositoryRoot: root, repository: true, branch: 'main', detached: false, head: 'a'.repeat(40), staged: [], unstaged: [{ path: 'README.md', status: 'M' }], untracked: [] }; }

describe('Independent Reviewer', () => {
  it('creates a fresh evidence-only context with every required input and no conversation transcript', async () => {
    const root = fixture(); const services = setup(root); let observed: ReviewContext | undefined;
    services.state.update('phase-14', { recentModifications: ['src/main.ts', 'test/main.test.ts', 'README.md', '../../etc/passwd'] });
    const analyzer: ReviewerAnalyzer = { analyze: async context => { observed = context; return { summary: 'Approved.', findings: [] }; } };
    const reviewer = new IndependentReviewer(root, services.state, services.executions, services.research, services.documentation, analyzer, services.reviews, baseline(root));
    const review = await reviewer.review('phase-14');
    expect(review).toMatchObject({ status: 'approved', iteration: 1 });
    expect(observed).toMatchObject({ objective: 'Implement independent review without sharing the implementation conversation.', acceptanceCriteria: ['Fresh review context', 'Structured findings', 'Completion approval'], relevantSource: [{ path: 'src/main.ts' }], tests: [{ path: 'test/main.test.ts' }], verificationResults: [{ step: 'test', status: 'passed' }], researchFindings: [{ id: 'research-1' }], documentationChanges: { changedFiles: ['README.md'] }, preexistingUserChanges: [{ path: 'README.md', status: 'M', category: 'unstaged' }] });
    expect('messages' in observed!).toBe(false);
    expect(JSON.stringify(observed?.relevantSource)).not.toContain('passwd');
    cleanup(root);
  });

  it('requires Manager evaluation, records confirmed work, and emits reviewer rejection', async () => {
    const root = fixture(); const services = setup(root);
    const analyzer: ReviewerAnalyzer = { analyze: async () => ({ summary: 'One issue.', findings: [finding()] }) };
    const reviewer = new IndependentReviewer(root, services.state, services.executions, services.research, services.documentation, analyzer, services.reviews);
    const review = await reviewer.review('phase-14');
    expect(review.status).toBe('pending-manager-evaluation');
    expect(() => reviewer.evaluate('phase-14', review.id, [])).toThrow('every finding');
    const evaluated = reviewer.evaluate('phase-14', review.id, [{ findingId: review.findings[0].id, decision: 'confirmed', rationale: 'The test gap is real.' }]);
    expect(evaluated.status).toBe('changes-requested');
    expect(services.state.read('phase-14')?.remainingWork).toContain('Reviewer: Add a negative-value behavior test.');
    const result = { toolId: 'evaluate_review_findings', status: 'success', data: evaluated } as ToolResult;
    expect(detectEscalationTriggers({ results: [result] })).toContainEqual(expect.objectContaining({ trigger: 'reviewer_rejection' }));
    cleanup(root);
  });

  it('accepts evidenced dismissals and mechanically invalidates approval after later changes', async () => {
    const root = fixture(); const services = setup(root);
    const analyzer: ReviewerAnalyzer = { analyze: async () => ({ summary: 'Potential issue.', findings: [finding()] }) };
    const reviewer = new IndependentReviewer(root, services.state, services.executions, services.research, services.documentation, analyzer, services.reviews);
    const review = await reviewer.review('phase-14');
    reviewer.evaluate('phase-14', review.id, [{ findingId: review.findings[0].id, decision: 'dismissed', rationale: 'The acceptance criteria explicitly define positive inputs only.' }]);
    const guard = new CompletionGuard(root, parseCompletionConfiguration({ gates: gates('independent_review_passes') }), new FileCompletionEvidenceStore(root), services.executions, services.documentation, services.reviews);
    expect(guard.evaluate('phase-14')).toMatchObject({ status: 'passed' });
    fs.appendFileSync(path.join(root, 'src', 'main.ts'), 'export const later = true;\n');
    expect(guard.evaluate('phase-14').outstanding[0]).toContain('evidence is stale');
    cleanup(root);
  });

  it('requires a clean re-review after confirmed fixes, tests, and documentation changes', async () => {
    const root = fixture(); const services = setup(root); let pass = 0;
    const analyzer: ReviewerAnalyzer = { analyze: async () => pass++ === 0 ? { summary: 'Fix required.', findings: [finding()] } : { summary: 'Fix verified.', findings: [] } };
    const reviewer = new IndependentReviewer(root, services.state, services.executions, services.research, services.documentation, analyzer, services.reviews);
    const first = await reviewer.review('phase-14'); reviewer.evaluate('phase-14', first.id, [{ findingId: first.findings[0].id, decision: 'confirmed', rationale: 'Confirmed.' }]);
    fs.appendFileSync(path.join(root, 'test', 'main.test.ts'), 'it("negative", () => expect(-1).toBe(-1));\n');
    services.executions.recordExecution('phase-14', execution());
    services.state.update('phase-14', { completedWork: ['Implemented change', 'Added negative test'], remainingWork: [], recentModifications: ['src/main.ts', 'test/main.test.ts', 'README.md'] });
    const second = await reviewer.review('phase-14');
    expect(second).toMatchObject({ iteration: 2, status: 'approved', findings: [] });
    expect(services.reviews.isCurrent(first)).toBe(false);
    cleanup(root);
  });

  it('validates finding structure, completion absence, and review tools', async () => {
    const parsed = parseReviewAnalysis(JSON.stringify({ summary: 'Issue.', findings: [{ severity: 'critical', confidence: 'high', location: 'src/main.ts:1', description: 'Unsafe.', evidence: 'Direct evidence.', recommendedAction: 'Fix it.' }] }));
    expect(parsed.findings[0]).toMatchObject({ severity: 'critical', confidence: 'high' });
    expect(() => parseReviewAnalysis('{"summary":"bad","findings":[{"severity":"urgent"}]}')).toThrow('invalid finding');
    const root = fixture(); const services = setup(root); const analyzer: ReviewerAnalyzer = { analyze: async () => ({ summary: 'Approved.', findings: [] }) };
    const reviewer = new IndependentReviewer(root, services.state, services.executions, services.research, services.documentation, analyzer, services.reviews);
    const guard = new CompletionGuard(root, parseCompletionConfiguration({ gates: gates('independent_review_passes') }), new FileCompletionEvidenceStore(root), services.executions, services.documentation, services.reviews);
    expect(guard.evaluate('phase-14').outstanding).toContain('Independent review has not run.');
    const registry = registerReviewTools(new ToolRegistry(), reviewer, services.reviews);
    expect(registry.list().map(tool => tool.id)).toEqual(['run_independent_review', 'evaluate_review_findings', 'get_review_state']);
    expect(await new ToolExecutor(registry, root).execute({ id: 'run_independent_review', arguments: {} }, { taskId: 'phase-14', agentId: 'manager' })).toMatchObject({ status: 'success', metadata: { source: 'review' } });
    cleanup(root);
  });
});
