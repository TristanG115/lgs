import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  COMPLETION_REQUIREMENTS, CompletionGuard, FileCompletionEvidenceStore, parseCompletionConfiguration,
  renderCompletionBlocked, runToolLoop, ToolExecutor, ToolRegistry,
  type CompletionGateConfiguration, type ExecutionResult, type ToolLoopModel
} from '../src/tools/index.js';
import { textMessage } from '../src/model/types.js';
import { writeRepositoryIndex } from '../src/intelligence/indexer.js';

type EvidenceEntry = { recordedAt: string; execution: ExecutionResult };

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lgs-completion-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'test'));
  fs.writeFileSync(path.join(root, 'src', 'main.ts'), 'export const ready = true;\n');
  fs.writeFileSync(path.join(root, 'test', 'main.test.ts'), 'it("works", () => {});\n');
  fs.writeFileSync(path.join(root, 'README.md'), '# Fixture\n');
  return root;
}
function cleanup(root: string): void { fs.rmSync(root, { recursive: true, force: true }); }
function gates(...required: (typeof COMPLETION_REQUIREMENTS)[number][]): CompletionGateConfiguration {
  return Object.fromEntries(COMPLETION_REQUIREMENTS.map(requirement => [requirement, required.includes(requirement)])) as CompletionGateConfiguration;
}
function execution(step: string, status: ExecutionResult['status'], error = ''): EvidenceEntry {
  const recordedAt = new Date().toISOString();
  return { recordedAt, execution: {
    id: `${step}-${status}-${Math.random()}`, request: { executable: 'npm', args: ['run', step], category: 'test', envKeys: [], verificationStep: step },
    status, startedAt: recordedAt, completedAt: recordedAt, durationMs: 1, exitCode: status === 'passed' ? 0 : 1,
    signal: null, timedOut: false, normalized: { command: `npm run ${step}`, exitCode: status === 'passed' ? 0 : 1,
      primaryError: error || undefined, relevantStack: [], fileLocations: [], stdout: [], stderr: error ? [error] : [], omittedLineCount: 0 }
  } };
}
function guard(root: string, required: (typeof COMPLETION_REQUIREMENTS)[number][], entries: EvidenceEntry[] = [], budgets: Record<string, number> = {}): CompletionGuard {
  const configuration = parseCompletionConfiguration({ gates: gates(...required), failureBudgets: budgets });
  return new CompletionGuard(root, configuration, new FileCompletionEvidenceStore(root), { read: () => entries });
}

describe('Completion Guard', () => {
  it('blocks a premature model completion and tells the model to continue', async () => {
    const root = fixture();
    const completion = guard(root, ['acceptance_criteria_addressed']);
    const prompts: string[] = [];
    const model: ToolLoopModel = { next: async messages => { prompts.push(JSON.stringify(messages)); return { text: 'Done.' }; } };
    const outcome = await runToolLoop({ model, executor: new ToolExecutor(new ToolRegistry(), root), messages: [textMessage('user', 'Implement it')],
      identity: { taskId: 'task-9' }, completionGuard: completion, maxTurns: 2 });
    expect(outcome.status).toBe('limit');
    expect(outcome.text).toContain('COMPLETION_BLOCKED');
    expect(outcome.text).toContain('Acceptance criteria addressed lacks evidence.');
    expect(prompts[1]).toContain('Continue working.');
    cleanup(root);
  });

  it('blocks missing or stale documentation evidence', () => {
    const root = fixture();
    const store = new FileCompletionEvidenceStore(root);
    const completion = new CompletionGuard(root, parseCompletionConfiguration({ gates: gates('documentation_current') }), store, { read: () => [] });
    expect(completion.evaluate('docs').outstanding).toContain('Documentation current lacks evidence.');
    store.record('docs', 'documentation_current', 'README describes Phase 9.', ['README.md']);
    fs.appendFileSync(path.join(root, 'README.md'), '\nChanged after review.\n');
    expect(completion.evaluate('docs').outstanding).toContain('Documentation current evidence is stale.');
    cleanup(root);
  });

  it('blocks failed tests and reports unresolved task failures', () => {
    const root = fixture();
    const result = guard(root, ['full_tests_pass', 'no_unresolved_task_failures'], [execution('test', 'failed', 'AssertionError: expected true')]).evaluate('tests');
    expect(result.status).toBe('blocked');
    expect(result.outstanding).toEqual(expect.arrayContaining(['Full tests pass failed or was interrupted.', '1 task verification failure(s) remain unresolved.']));
    cleanup(root);
  });

  it('blocks a stale CODEBASE_MAP', () => {
    const root = fixture();
    writeRepositoryIndex(root);
    fs.appendFileSync(path.join(root, 'src', 'main.ts'), 'export const changed = true;\n');
    const result = guard(root, ['codebase_map_current']).evaluate('map');
    expect(result.status).toBe('blocked');
    expect(result.outstanding[0]).toContain('src/main.ts');
    cleanup(root);
  });

  it('exhausts retry budgets for substantially repeated errors', () => {
    const root = fixture();
    const entries = [execution('test', 'failed', 'src/a.test.ts:10 Expected 1'), execution('test', 'failed', 'src/b.test.ts:99 Expected 2')];
    const result = guard(root, [], entries, { same_error_retry_limit: 2, total_fix_attempt_limit: 10, escalation_threshold: 2 }).evaluate('retry');
    expect(result.failureBudget).toMatchObject({ exhausted: true, escalationRequired: true, largestSameErrorCount: 2 });
    expect(guard(root, [], entries, { same_error_retry_limit: 2, total_fix_attempt_limit: 10, escalation_threshold: 2 }).failures.canAttempt('retry').allowed).toBe(false);
    expect(result.status).toBe('blocked');
    expect(renderCompletionBlocked(result)).toContain('same substantial error reached the retry limit');
    cleanup(root);
  });

  it('accepts a fully evidenced completion candidate', () => {
    const root = fixture();
    writeRepositoryIndex(root);
    const store = new FileCompletionEvidenceStore(root);
    for (const [requirement, summary, files] of [
      ['acceptance_criteria_addressed', 'Every Phase 9 criterion is covered.', []],
      ['implementation_complete', 'Completion Guard is implemented.', ['src/main.ts']],
      ['relevant_tests_added_or_updated', 'Completion tests cover the guard.', ['test/main.test.ts']],
      ['documentation_current', 'README documents Completion Guard.', ['README.md']]
    ] as const) store.record('success', requirement, summary, [...files]);
    const entries = ['targetedTest', 'test', 'typecheck', 'lint', 'build'].map(step => execution(step, 'passed'));
    const completion = new CompletionGuard(root, parseCompletionConfiguration(), store, { read: () => entries });
    const result = completion.evaluate('success');
    expect(result.status).toBe('passed');
    expect(result.progress.passed).toBe(result.progress.required);
    expect(result.checklist.filter(item => item.required).every(item => item.evidence.length > 0 || item.requirement === 'no_unresolved_task_failures')).toBe(true);
    cleanup(root);
  });
});
