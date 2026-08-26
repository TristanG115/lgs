import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  EscalationController, FailureBudgetTracker, FileTaskStateStore, RuleBasedWatchdogAnalyzer, ToolExecutor, ToolRegistry, WatchdogService,
  detectEscalationTriggers, parseWatchdogConfiguration, parseWatchdogFinding, runToolLoop,
  type CompletionEvaluation, type ExecutionResult, type ToolLoopModel, type ToolResult, type WatchdogAnalyzer, type WatchdogFinding, type WatchdogInput
} from '../src/tools/index.js';
import { textMessage, textFromMessage } from '../src/model/types.js';

function fixture(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'lgs-watchdog-')); }
function cleanup(root: string): void { fs.rmSync(root, { recursive: true, force: true }); }
function task(root: string, id = 'task-11'): FileTaskStateStore { const store = new FileTaskStateStore(root); store.ensure(id, 'Implement Phase 11 without scope creep.'); return store; }

describe('Watchdog', () => {
  it('persists compact LGS-owned task state across service instances', () => {
    const root = fixture();
    const first = task(root);
    first.update('task-11', { acceptanceCriteria: ['Watchdog is read-only'], currentPlan: ['Implement state'], completedWork: ['Types added'], remainingWork: ['Run tests'], recentModifications: ['src/watchdog/types.ts'] });
    expect(new FileTaskStateStore(root).read('task-11')).toMatchObject({ objective: 'Implement Phase 11 without scope creep.', acceptanceCriteria: ['Watchdog is read-only'], revision: 1 });
    cleanup(root);
  });

  it('passes only compact state to the analyzer and persists structured findings', async () => {
    const root = fixture(); const state = task(root);
    state.update('task-11', { acceptanceCriteria: ['Tests pass'], currentPlan: ['Run tests'], completedWork: [], remainingWork: ['Tests pass'], recentModifications: ['test/watchdog.test.ts'] });
    let observed: WatchdogInput | undefined;
    const analyzer: WatchdogAnalyzer = { analyze: async input => { observed = input; return { classification: 'ON_TRACK', evidence: ['Plan contains tests'], explanation: 'Aligned.', recommendedNextAction: 'Run tests.' }; } };
    const watchdog = new WatchdogService(root, state, { read: () => [] }, analyzer, 2);
    const finding = await watchdog.evaluate('task-11');
    expect(observed).toEqual({ objective: 'Implement Phase 11 without scope creep.', acceptanceCriteria: ['Tests pass'], currentPlan: ['Run tests'], completedWork: [], remainingWork: ['Tests pass'], recentModifications: ['test/watchdog.test.ts'], recentFailures: [], explicitUncertainty: undefined, stalled: false });
    expect(finding).toMatchObject({ classification: 'ON_TRACK', evidence: ['Plan contains tests'], stateRevision: 1 });
    expect(watchdog.read('task-11')).toHaveLength(1);
    cleanup(root);
  });

  it('detects stalled work and explicit uncertainty without editing workspace code', async () => {
    const root = fixture(); const state = task(root);
    state.update('task-11', { remainingWork: ['Choose an API'] });
    const watchdog = new WatchdogService(root, state, { read: () => [] }, new RuleBasedWatchdogAnalyzer(), 1);
    expect((await watchdog.evaluate('task-11')).classification).toBe('ON_TRACK');
    expect((await watchdog.evaluate('task-11')).classification).toBe('OFF_TRACK');
    state.update('task-11', { explicitUncertainty: 'The upstream API contract is unclear.' });
    expect((await watchdog.evaluate('task-11')).classification).toBe('NEEDS_RESEARCH');
    expect(fs.existsSync(path.join(root, 'src'))).toBe(false);
    cleanup(root);
  });

  it('supports every structured classification and rejects transcript-like malformed output', () => {
    for (const classification of ['ON_TRACK', 'OFF_TRACK', 'MISSING_REQUIREMENT', 'NEEDS_RESEARCH', 'RECONSIDER_APPROACH', 'POTENTIAL_SCOPE_CREEP']) {
      expect(parseWatchdogFinding(JSON.stringify({ classification, evidence: ['e'], explanation: 'why', recommendedNextAction: 'next' }))?.classification).toBe(classification);
    }
    expect(parseWatchdogFinding('I inspected the entire transcript...')).toBeUndefined();
  });

  it('automatically prods an uncertain final response, escalates, and preserves loop context', async () => {
    const root = fixture(); const state = task(root);
    const configuration = parseWatchdogConfiguration({ escalation: { routes: { difficult: { profileId: 'remote', model: 'large-model' } } } });
    const escalation = new EscalationController(root, configuration, state, { profileId: 'local', model: 'small-model' });
    const observed: string[] = []; const switches: { profileId: string; model: string }[] = [];
    const model: ToolLoopModel = {
      next: async messages => { observed.push(messages.map(textFromMessage).join('|')); return observed.length === 1 ? { text: "I'm uncertain about the API." } : { text: 'Resolved with the persisted context.' }; },
      switchModel: identity => { switches.push(identity); }
    };
    const outcome = await runToolLoop({ model, executor: new ToolExecutor(new ToolRegistry(), root), messages: [textMessage('user', 'Original objective')], identity: { taskId: 'task-11' }, escalation, maxTurns: 2 });
    expect(outcome).toMatchObject({ status: 'complete', text: 'Resolved with the persisted context.', turns: 2 });
    expect(switches).toEqual([{ profileId: 'remote', model: 'large-model' }]);
    expect(observed[1]).toContain("I'm uncertain about the API.");
    expect(observed[1]).toContain('CONTINUE_WORKING');
    expect(state.read('task-11')?.objective).toBe('Implement Phase 11 without scope creep.');
    expect(escalation.read('task-11')).toMatchObject([{ trigger: 'explicit_uncertainty', from: { level: 'manager' }, to: { level: 'difficult', profileId: 'remote', model: 'large-model' } }]);
    cleanup(root);
  });

  it('routes worker to manager to difficult and records why each escalation occurred', () => {
    const root = fixture(); const state = task(root);
    const configuration = parseWatchdogConfiguration({ escalation: { routes: { manager: 'manager-model', difficult: 'large-model', cloud: { profileId: 'cloud-profile', model: 'cloud-model' } } } });
    const escalation = new EscalationController(root, configuration, state, { profileId: 'local', model: 'worker-model' }, 'worker');
    expect(escalation.escalate('task-11', 'reviewer_rejection', 'Reviewer requested changes.').to).toMatchObject({ level: 'manager', model: 'manager-model' });
    state.update('task-11', { remainingWork: ['Address review'] });
    expect(escalation.escalate('task-11', 'repeated_failure', 'Same test failed twice.').to).toMatchObject({ level: 'difficult', model: 'large-model' });
    expect(escalation.read('task-11').map(record => record.reason)).toEqual(['Reviewer requested changes.', 'Same test failed twice.']);
    const restored = new EscalationController(root, configuration, state, { profileId: 'local', model: 'worker-model' });
    expect(restored.resume('task-11')).toBe(true);
    expect(restored.currentModel()).toEqual({ profileId: 'local', model: 'large-model' });
    cleanup(root);
  });

  it('starts a fresh bounded failure segment after a recorded model escalation', () => {
    const root = fixture(); const state = task(root);
    const recordedAt = new Date(Date.now() - 1_000).toISOString();
    const failedExecution = { status: 'failed', normalized: { primaryError: 'same error' } } as ExecutionResult;
    const evidence = { read: () => [{ recordedAt, execution: failedExecution }, { recordedAt, execution: failedExecution }] };
    const tracker = new FailureBudgetTracker(evidence, { same_error_retry_limit: 2, total_fix_attempt_limit: 10, escalation_threshold: 2 });
    expect(tracker.state('task-11').exhausted).toBe(true);
    const escalation = new EscalationController(root, parseWatchdogConfiguration({ escalation: { routes: { difficult: 'large-model' } } }), state, { profileId: 'local', model: 'small-model' });
    escalation.escalate('task-11', 'retry_exhaustion', 'Retry budget exhausted.');
    tracker.useEscalations(escalation);
    expect(tracker.state('task-11')).toMatchObject({ exhausted: false, totalFailures: 0 });
    cleanup(root);
  });

  it('detects retry exhaustion, reviewer rejection, invalid tools, unresolved criteria, uncertainty, and Watchdog recommendations', () => {
    const completion = { outstanding: ['Acceptance criterion #2 lacks verification'], failureBudget: { exhausted: true, largestSameErrorCount: 3, reason: 'Retry limit reached.' } } as CompletionEvaluation;
    const results = [
      { toolId: 'read_file', status: 'error', error: { code: 'invalid_request' } },
      { toolId: 'delegate_subtasks', status: 'success', data: { results: [{ role: 'reviewer', report: { recommendation: 'Changes required' } }] } }
    ] as ToolResult[];
    const watchdog: WatchdogFinding = { classification: 'RECONSIDER_APPROACH', evidence: ['same failure'], explanation: 'Repeated.', recommendedNextAction: 'Change strategy.' };
    expect(detectEscalationTriggers({ results, responseText: 'I am not sure this is correct.', completion, watchdog }).map(item => item.trigger)).toEqual([
      'retry_exhaustion', 'invalid_tool_request', 'reviewer_rejection', 'unresolved_criteria', 'explicit_uncertainty', 'watchdog_recommendation'
    ]);
  });
});
