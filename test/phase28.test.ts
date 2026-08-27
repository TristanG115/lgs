import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  BrowserAgent, ContextLifecycleManager, FileResearchCycleStore, FileResearchRequirementStore, FileTaskStateStore,
  PlanningArtifactStore, RepeatedApproachError, ResearchCycleEngine, ResearchExecutionGuard, ResearchSupervisor,
  TaskArtifactPipeline, ToolExecutor, ToolRegistry, detectResearchTriggers, parseContextLifecycleConfiguration,
  parseResearchConfiguration, registerPlanningTools, runToolLoop, type BrowserSession, type EvidenceRecord, type ToolIdentity, type ToolLoopModel
} from '../src/tools/index.js';
import { textMessage } from '../src/model/types.js';

function fixture(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'lgs-phase28-')); }
function cleanup(root: string): void { fs.rmSync(root, { recursive: true, force: true }); }
const evidence = (id = 'e-1', state: EvidenceRecord['state'] = 'STRONG'): EvidenceRecord => ({ id, claim: 'Observed behavior matches the specification.', state, provenance: ['https://docs.example.test/api'], recordedAt: new Date().toISOString() });

describe('Phase 28 planning and research sessions', () => {
  it('persists PLAN.md, approval state, and append-only revision rationale across restarts', () => {
    const root = fixture(); const tasks = new FileTaskStateStore(root); const plans = new PlanningArtifactStore(root, tasks);
    plans.create('phase-28', { objective: 'Build durable research.', acceptanceCriteria: ['Plan survives restart'], currentUnderstanding: ['Planning is read-only'], approach: ['Persist artifacts'], expectedAreas: ['src/planning'], implementationStages: ['Implement store'], verificationPlan: ['Run tests'], risks: ['Stale rationale'], openQuestions: [] }, 'wait-for-approval');
    plans.revise('phase-28', 'Use an append-only revision log.', 'Implementation evidence invalidated the initial assumption.', ['test failure #2']); plans.approve('phase-28');
    const restored = new PlanningArtifactStore(root, new FileTaskStateStore(root)).read('phase-28');
    expect(restored).toMatchObject({ status: 'approved', revisions: [{ revision: 1, reason: 'Implementation evidence invalidated the initial assumption.' }] });
    expect(fs.readFileSync(path.join(root, '.lgs', 'tasks', 'phase-28', 'PLAN.md'), 'utf8')).toContain('## Revision history');
    expect(tasks.read('phase-28')?.currentPlan).toEqual(['Implement store']); cleanup(root);
  });

  it('honors automatic plan handoff while keeping chat and approval-wait plans read-only', async () => {
    const root = fixture(); const registry = registerPlanningTools(new ToolRegistry(), new FileTaskStateStore(root)); let writes = 0;
    registry.register({ id: 'write_file', description: 'mutate', permission: { access: 'execute', scope: 'workspace', network: false, category: 'process' }, argumentSchema: { type: 'object', properties: {}, additionalProperties: false }, execute: () => ({ data: { writes: ++writes } }) });
    const turns = [
      { toolCalls: [{ id: 'create_plan_task', arguments: { taskId: 'auto-plan', objective: 'Plan and implement.', acceptanceCriteria: ['Written'], implementationStages: ['Write'], handoff: 'implement-automatically' } }] },
      { toolCalls: [{ id: 'write_file', arguments: {} }] }, { text: 'Implemented.' }
    ];
    const model: ToolLoopModel = { next: async () => turns.shift() ?? { text: 'done' } }; const identity: ToolIdentity = { taskId: 'auto-plan', sessionId: 's', taskMode: 'plan' };
    const result = await runToolLoop({ model, executor: new ToolExecutor(registry, root), messages: [textMessage('user', 'Plan then implement')], identity });
    expect(result.status).toBe('complete'); expect(writes).toBe(1); expect(identity.taskMode).toBe('implement');
    expect((await new ToolExecutor(registry, root).execute({ id: 'write_file', arguments: {} }, { taskMode: 'chat' })).error?.message).toContain('Chat Mode'); cleanup(root);
  });

  it('persists successful and unsuccessful research cycles and prevents equivalent failed experiments', () => {
    const root = fixture(); const store = new FileResearchCycleStore(root); const engine = new ResearchCycleEngine(store, parseResearchConfiguration().budgets);
    const first = engine.start('research-28', { question: 'Why does parsing fail?', hypothesis: 'The parser rejects trailing commas', confidence: .55, experiment: 'Run parser against a fixture with a trailing comma', expectedObservation: 'The parser returns a syntax error' });
    engine.complete('research-28', first.id, { actualObservation: 'Syntax error at byte 10.', analysis: 'The fixture isolates the comma.', conclusion: 'REJECTED', learned: 'The error also occurs without the comma.', evidence: ['fixture log'], nextAction: 'Test encoding.' });
    expect(() => engine.start('research-28', { question: 'Why does parsing fail?', hypothesis: 'The parser rejects trailing commas', confidence: .5, experiment: 'Run parser against a fixture with a trailing comma', expectedObservation: 'Syntax error' })).toThrow(RepeatedApproachError);
    const second = engine.start('research-28', { question: 'Why does parsing fail?', hypothesis: 'The document encoding is invalid', confidence: .7, experiment: 'Inspect and normalize the fixture byte order mark', expectedObservation: 'Normalized input parses' });
    engine.addEvidence('research-28', [evidence()]); engine.complete('research-28', second.id, { actualObservation: 'Normalized input parsed.', analysis: 'Only the BOM changed.', conclusion: 'SUPPORTED', learned: 'The BOM caused the failure.', evidence: ['e-1'], nextAction: 'Document the boundary.', bestExplanation: 'A BOM reaches the parser.', recommendation: 'Strip the BOM.' });
    expect(engine.completeResearch('research-28').status).toBe('completed');
    const restored = new FileResearchCycleStore(root).read('research-28'); expect(restored?.experiments).toHaveLength(2); expect(restored?.rejectedApproaches).toContain('The parser rejects trailing commas');
    expect(fs.readFileSync(path.join(root, '.lgs', 'tasks', 'research-28', 'RESEARCH.md'), 'utf8')).toContain('The BOM caused the failure.'); cleanup(root);
  });

  it('pauses rather than claims success when a research budget is exhausted', () => {
    const root = fixture(); const store = new FileResearchCycleStore(root); const engine = new ResearchCycleEngine(store, { maximumCycles: 1, maximumConsecutiveFailedCycles: 5, wallClockMinutes: 60, minimumProgressCycles: 3 });
    const cycle = engine.start('budget-28', { question: 'Q?', hypothesis: 'H one', confidence: .2, experiment: 'Try one bounded experiment', expectedObservation: 'One result' });
    engine.complete('budget-28', cycle.id, { actualObservation: 'No result', analysis: 'Inconclusive', conclusion: 'INCONCLUSIVE', learned: 'Need other evidence', nextAction: 'Escalate' });
    expect(store.read('budget-28')).toMatchObject({ status: 'paused', pauseReason: expect.stringContaining('Maximum cycle budget') }); cleanup(root);
  });

  it('forces research for uncertainty and version-sensitive assumptions before mutating execution', async () => {
    const root = fixture(); const requirements = new FileResearchRequirementStore(root);
    expect(detectResearchTriggers("I'm uncertain whether the latest API supports this.", 'when-uncertain')).toEqual(expect.arrayContaining(['explicit-uncertainty', 'version-sensitive-assumption']));
    requirements.require('enforce-28', 'version-sensitive-assumption', 'The latest API contract is unverified.');
    const registry = new ToolRegistry(); registry.register({ id: 'write_file', description: 'mutate', permission: { access: 'execute', scope: 'workspace', network: false, category: 'process' }, argumentSchema: { type: 'object', properties: {}, additionalProperties: false }, execute: () => ({ data: { written: true } }) });
    const executor = new ToolExecutor(registry, root, undefined, undefined, [new ResearchExecutionGuard(requirements, true)]);
    expect((await executor.execute({ id: 'write_file', arguments: {} }, { taskId: 'enforce-28' })).error?.message).toContain('RESEARCH_REQUIRED');
    requirements.satisfy('enforce-28', [{ id: 'f-1', operation: 'documentation_search', sourceUrl: 'https://docs.example.test', title: 'Docs', retrievedAt: new Date(Date.now() + 1_000).toISOString(), finding: 'Supported.', authority: 'official-documentation', priority: 1, task: 'enforce-28', requestingAgent: 'manager', query: 'api', queryKey: 'k' }]);
    expect((await executor.execute({ id: 'write_file', arguments: {} }, { taskId: 'enforce-28' })).status).toBe('success'); cleanup(root);
  });

  it('compacts and rotates disposable sessions only after a complete checkpoint', () => {
    const root = fixture(); const configuration = parseContextLifecycleConfiguration({ softPressurePercent: 70, compactionPercent: 82, rotationPercent: 92 }); const lifecycle = new ContextLifecycleManager(root, configuration);
    expect(lifecycle.observe('context-28', 'session-a', 7_100, 10_000).action).toBe('retrieval-discipline'); expect(lifecycle.observe('context-28', 'session-a', 8_300, 10_000).action).toBe('compact');
    expect(lifecycle.compact('context-28', 2_400).compactedTokensSaved).toBe(2_400); expect(lifecycle.observe('context-28', 'session-a', 9_300, 10_000).action).toBe('rotate');
    expect(() => lifecycle.rotate('context-28', 'session-b')).toThrow('checkpoint');
    lifecycle.checkpoint('context-28', { taskId: 'context-28', sessionId: 'session-a', createdAt: new Date().toISOString(), establishedFacts: ['Fact'], decisions: ['Decision'], currentHypothesis: 'Hypothesis', experimentState: 'Experiment complete', modifiedFiles: ['src/a.ts'], failedApproaches: ['Old path'], unresolvedQuestions: ['Question'], acceptanceStatus: ['One pending'], nextRecommendedAction: 'Continue verification' });
    expect(lifecycle.rotate('context-28', 'session-b')).toMatchObject({ sessionId: 'session-b', rotations: 1, action: 'normal' }); expect(lifecycle.reconstruct('context-28')[0].content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('Continue verification') }); cleanup(root);
  });

  it('extracts and indexes task attachments without injecting a large artifact wholesale', () => {
    const root = fixture(); const pipeline = new TaskArtifactPipeline(root); const text = 'alpha research evidence\n'.repeat(1_000);
    const artifact = pipeline.ingest('artifact-28', { name: 'notes.md', mediaType: 'text/markdown', data: Buffer.from(text), source: 'drop' });
    expect(artifact).toMatchObject({ format: 'markdown', source: 'drop', truncated: false }); expect(artifact.indexPath).toBeTruthy(); expect(pipeline.retrieve('artifact-28', 'alpha evidence', 2)).toHaveLength(2);
    const image = pipeline.ingest('artifact-28', { name: 'screen.png', mediaType: 'image/png', data: Buffer.from([137, 80, 78, 71]), source: 'screenshot', primaryModelHasVision: false }); expect(image.visionStatus).toBe('pending-delegation');
    expect(() => pipeline.ingest('artifact-28', { name: 'empty.txt', mediaType: 'text/plain', data: Buffer.alloc(0), source: 'composer' })).toThrow('Attachment size'); cleanup(root);
  });

  it('gates consequential external BrowserAgent actions and audits the decision', async () => {
    const root = fixture(); const calls: string[] = []; const session = { open: async (url: string) => ({ url, title: 'External' }), click: async (selector: string) => { calls.push(selector); }, type: async () => {}, getText: async () => 'text' } as unknown as BrowserSession;
    const denied = new BrowserAgent(root, session, { browser: { externalSites: true, consequentialActions: 'ask' } }, async () => false); await denied.open('https://example.test', 'browser-28'); await expect(denied.click('button#purchase', 'browser-28')).rejects.toThrow('denied'); expect(calls).toEqual([]); expect(denied.records('browser-28').at(-1)?.status).toBe('denied');
    const allowed = new BrowserAgent(root, session, { browser: { externalSites: true, consequentialActions: 'ask' } }, async () => true); await allowed.open('https://example.test', 'browser-28'); await allowed.click('button#purchase', 'browser-28'); expect(calls).toEqual(['button#purchase']); cleanup(root);
  });

  it('keeps research supervision read-only and rejects unsupported confidence-only conclusions', () => {
    const root = fixture(); const store = new FileResearchCycleStore(root); const engine = new ResearchCycleEngine(store, parseResearchConfiguration().budgets); const cycle = engine.start('supervise-28', { question: 'Does X work?', hypothesis: 'X returns the expected result', confidence: .99, experiment: 'Test X against the expected result', expectedObservation: 'Expected result' }); const notebook = store.read('supervise-28')!;
    expect(new ResearchSupervisor().evaluate(notebook, cycle).status).toBe('ON_TRACK'); expect(() => engine.completeResearch('supervise-28')).toThrow('supported'); cleanup(root);
  });
});
