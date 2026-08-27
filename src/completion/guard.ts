import * as fs from 'node:fs';
import * as path from 'node:path';
import { getFreshness, type RepositoryIndex } from '../intelligence/indexer.js';
import type { ExecutionResult } from '../execution/types.js';
import type { VerificationStep } from '../verification/config.js';
import { FileCompletionEvidenceStore } from './evidence.js';
import { FailureBudgetTracker } from './failures.js';
import type { CompletionChecklistItem, CompletionConfiguration, CompletionEvaluation, CompletionEvidence, CompletionRequirement, DocumentationAuditReader, ExecutionEvidenceReader, IndependentReviewReader, RuntimeVerificationReader } from './types.js';

const LABELS: Record<CompletionRequirement, string> = {
  acceptance_criteria_addressed: 'Acceptance criteria addressed', implementation_complete: 'Implementation complete',
  relevant_tests_added_or_updated: 'Relevant tests added or updated', targeted_tests_pass: 'Targeted tests pass',
  full_tests_pass: 'Full tests pass', typecheck_passes: 'Typecheck passes', lint_passes: 'Lint passes',
  build_succeeds: 'Build succeeds', documentation_current: 'Documentation current', codebase_map_current: 'CODEBASE_MAP current',
  runtime_verification_passes: 'Runtime verification passes', independent_review_passes: 'Independent review passes',
  no_unresolved_task_failures: 'No unresolved task failures'
};
const STEP_REQUIREMENT: Partial<Record<CompletionRequirement, VerificationStep>> = {
  targeted_tests_pass: 'targetedTest', full_tests_pass: 'test', typecheck_passes: 'typecheck', lint_passes: 'lint', build_succeeds: 'build'
};

export class CompletionGuard {
  readonly failures: FailureBudgetTracker;
  constructor(
    private readonly workspaceRoot: string,
    private readonly configuration: CompletionConfiguration,
    private readonly completionEvidence: FileCompletionEvidenceStore,
    private readonly executions: ExecutionEvidenceReader,
    private readonly documentationAudits?: DocumentationAuditReader,
    private readonly independentReviews?: IndependentReviewReader, private readonly runtimeVerifications?: RuntimeVerificationReader
  ) { this.failures = new FailureBudgetTracker(executions, configuration.failureBudgets); }

  async attempt(taskId: string): Promise<CompletionEvaluation> { return this.evaluate(taskId); }

  evaluate(taskId: string): CompletionEvaluation {
    const recorded = this.completionEvidence.read(taskId);
    const executions = this.executions.read(taskId);
    const profile = taskProfile(this.workspaceRoot, taskId);
    const checklist = (Object.keys(this.configuration.gates) as CompletionRequirement[]).map(requirement => this.evaluateRequirement(taskId, requirement, this.configuration.gates[requirement] && requiredForProfile(requirement, profile), recorded, executions));
    const failureBudget = this.failures.state(taskId);
    const required = checklist.filter(item => item.required);
    const outstanding = required.filter(item => !item.passed).map(item => item.detail);
    if (failureBudget.exhausted) outstanding.push(failureBudget.reason ?? 'The task failure budget is exhausted.');
    return {
      taskId, status: outstanding.length ? 'blocked' : 'passed', progress: { passed: required.filter(item => item.passed).length, required: required.length },
      checklist, outstanding, failureBudget, attemptedAt: new Date().toISOString()
    };
  }

  private evaluateRequirement(taskId: string, requirement: CompletionRequirement, required: boolean, recorded: CompletionEvidence[], executions: { recordedAt: string; execution: ExecutionResult }[]): CompletionChecklistItem {
    if (!required) return { requirement, label: LABELS[requirement], required, passed: true, detail: `${LABELS[requirement]} is not required.`, evidence: [] };
    const step = STEP_REQUIREMENT[requirement];
    if (step) return commandItem(requirement, step, executions);
    if (requirement === 'documentation_current' && this.documentationAudits) return this.documentationItem(taskId);
    if (requirement === 'independent_review_passes' && this.independentReviews) return this.independentReviewItem(taskId);
    if (requirement === 'runtime_verification_passes' && this.runtimeVerifications) return this.runtimeItem(taskId);
    if (requirement === 'codebase_map_current') return this.mapItem();
    if (requirement === 'no_unresolved_task_failures') return unresolvedItem(executions);
    const candidates = recorded.filter(entry => entry.requirement === requirement);
    const current = [...candidates].reverse().find(entry => this.completionEvidence.isCurrent(entry));
    return current
      ? { requirement, label: LABELS[requirement], required, passed: true, detail: current.summary, evidence: [current] }
      : { requirement, label: LABELS[requirement], required, passed: false, detail: candidates.length ? `${LABELS[requirement]} evidence is stale.` : `${LABELS[requirement]} lacks evidence.`, evidence: [] };
  }

  private mapItem(): CompletionChecklistItem {
    const requirement: CompletionRequirement = 'codebase_map_current';
    try {
      const index = JSON.parse(fs.readFileSync(path.join(this.workspaceRoot, '.lgs', 'index.json'), 'utf8')) as RepositoryIndex;
      const freshness = getFreshness(this.workspaceRoot, index);
      const passed = freshness.index === 'current' && freshness.codebaseMap === 'current';
      const evidence: CompletionEvidence = { id: `map-${index.generatedAt}`, requirement, summary: passed ? 'Repository index and CODEBASE_MAP match the workspace.' : `Stale entries: ${freshness.staleEntries.join(', ') || 'map metadata'}.`, recordedAt: freshness.checkedAt, source: 'repository-intelligence' };
      return { requirement, label: LABELS[requirement], required: true, passed, detail: evidence.summary, evidence: [evidence] };
    } catch { return { requirement, label: LABELS[requirement], required: true, passed: false, detail: 'CODEBASE_MAP current check could not find a valid repository index.', evidence: [] }; }
  }

  private documentationItem(taskId: string): CompletionChecklistItem {
    const requirement: CompletionRequirement = 'documentation_current';
    const audit = this.documentationAudits?.read(taskId);
    if (!audit) return { requirement, label: LABELS[requirement], required: true, passed: false, detail: 'DocumentationAgent audit has not run after the current modifications.', evidence: [] };
    if (!this.documentationAudits?.isCurrent(audit)) return { requirement, label: LABELS[requirement], required: true, passed: false, detail: 'DocumentationAgent audit is stale because code, documentation, CODEBASE_MAP, or task state changed.', evidence: [] };
    const stale = audit.assessments.filter(item => item.status === 'stale');
    const summary = stale.length ? `Documentation remains stale: ${stale.map(item => item.category).join(', ')}.` : audit.summary;
    const evidence: CompletionEvidence = { id: audit.id, requirement, summary, recordedAt: audit.createdAt, source: 'documentation-audit', documentationAuditId: audit.id };
    return { requirement, label: LABELS[requirement], required: true, passed: stale.length === 0, detail: summary, evidence: [evidence] };
  }

  private independentReviewItem(taskId: string): CompletionChecklistItem {
    const requirement: CompletionRequirement = 'independent_review_passes';
    const review = this.independentReviews?.latest(taskId);
    if (!review) return { requirement, label: LABELS[requirement], required: true, passed: false, detail: 'Independent review has not run.', evidence: [] };
    if (!this.independentReviews?.isCurrent(review)) return { requirement, label: LABELS[requirement], required: true, passed: false, detail: 'Independent review evidence is stale after later code, test, verification, research, documentation, map, or task-state changes.', evidence: [] };
    const passed = review.status === 'approved';
    const summary = passed ? `Independent review iteration ${review.iteration} approved the current evidence.`
      : review.status === 'pending-manager-evaluation' ? `Independent review iteration ${review.iteration} awaits Manager evaluation.`
      : `Independent review iteration ${review.iteration} requested changes.`;
    const evidence: CompletionEvidence = { id: review.id, requirement, summary, recordedAt: review.evaluatedAt ?? review.createdAt, source: 'independent-review', reviewId: review.id };
    return { requirement, label: LABELS[requirement], required: true, passed, detail: summary, evidence: [evidence] };
  }
  private runtimeItem(taskId: string): CompletionChecklistItem {
    const requirement: CompletionRequirement = 'runtime_verification_passes'; const runtime = this.runtimeVerifications?.latest(taskId);
    if (!runtime) return { requirement, label: LABELS[requirement], required: true, passed: false, detail: 'Runtime verification has not run.', evidence: [] };
    const evidence: CompletionEvidence = { id: runtime.id, requirement, summary: runtime.summary, recordedAt: runtime.createdAt, source: 'execution' };
    return { requirement, label: LABELS[requirement], required: true, passed: runtime.status === 'passed', detail: runtime.summary, evidence: [evidence] };
  }
}

function taskProfile(root: string, taskId: string): string | undefined { try { const state = JSON.parse(fs.readFileSync(path.join(root, '.lgs', 'tasks', taskId, 'state.json'), 'utf8')) as { profile?: unknown }; return typeof state.profile === 'string' ? state.profile : undefined; } catch { return; } }
function requiredForProfile(requirement: CompletionRequirement, profile: string | undefined): boolean {
  if (!profile || profile === 'Software Engineering' || profile === 'Mixed') return true;
  return ['acceptance_criteria_addressed', 'implementation_complete', 'no_unresolved_task_failures'].includes(requirement);
}

export function renderCompletionBlocked(evaluation: CompletionEvaluation): string {
  return ['COMPLETION_BLOCKED', '', 'Outstanding:', '', ...evaluation.outstanding.map(item => `- ${item}`), '', 'Continue working.'].join('\n');
}

function commandItem(requirement: CompletionRequirement, step: VerificationStep, entries: { recordedAt: string; execution: ExecutionResult }[]): CompletionChecklistItem {
  const relevant = entries.filter(entry => entry.execution.request.verificationStep === step);
  const latest = relevant.at(-1);
  const passed = latest?.execution.status === 'passed';
  const evidence: CompletionEvidence[] = latest ? [{ id: latest.execution.id, requirement, summary: `${latest.execution.normalized.command} ${latest.execution.status} with exit code ${latest.execution.exitCode ?? 'none'}.`, recordedAt: latest.recordedAt, source: 'execution', executionId: latest.execution.id }] : [];
  return { requirement, label: LABELS[requirement], required: true, passed, detail: passed ? evidence[0].summary : latest ? `${LABELS[requirement]} failed or was interrupted.` : `${LABELS[requirement]} have not run.`, evidence };
}

function unresolvedItem(entries: { recordedAt: string; execution: ExecutionResult }[]): CompletionChecklistItem {
  const requirement: CompletionRequirement = 'no_unresolved_task_failures';
  const unresolved: ExecutionResult[] = [];
  for (const entry of entries) {
    const execution = entry.execution;
    const step = execution.request.verificationStep;
    if (!step) continue;
    if (execution.status === 'passed') {
      for (let index = unresolved.length - 1; index >= 0; index--) if (unresolved[index].request.verificationStep === step) unresolved.splice(index, 1);
    } else if (execution.status !== 'denied' && execution.status !== 'cancelled') unresolved.push(execution);
  }
  const detail = unresolved.length ? `${unresolved.length} task verification failure(s) remain unresolved.` : 'No unresolved task failures remain.';
  const evidence: CompletionEvidence[] = unresolved.length
    ? unresolved.map(execution => ({ id: execution.id, requirement, summary: `${execution.normalized.command} remains ${execution.status}.`, recordedAt: execution.completedAt, source: 'execution', executionId: execution.id }))
    : [{ id: 'task-execution-history', requirement, summary: detail, recordedAt: entries.at(-1)?.recordedAt ?? new Date().toISOString(), source: 'execution' }];
  return { requirement, label: LABELS[requirement], required: true, passed: !unresolved.length, detail, evidence };
}
