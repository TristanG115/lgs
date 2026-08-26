import { randomUUID } from 'node:crypto';
import type { FileDocumentationAuditStore } from '../documentation/store.js';
import type { FileTaskEvidenceStore } from '../execution/evidence.js';
import type { FileResearchStore } from '../research/store.js';
import type { GitBaseline, GitCommandRunner } from '../tools/git.js';
import type { FileTaskStateStore } from '../watchdog/state.js';
import { collectReviewContext } from './context.js';
import { FileReviewStore } from './store.js';
import type { FindingDisposition, ReviewRecord, ReviewerAnalyzer } from './types.js';

export class IndependentReviewer {
  constructor(
    private readonly workspaceRoot: string, private readonly taskState: FileTaskStateStore,
    private readonly executions: FileTaskEvidenceStore, private readonly research: FileResearchStore,
    private readonly documentation: FileDocumentationAuditStore, private readonly analyzer: ReviewerAnalyzer,
    private readonly store: FileReviewStore, private readonly gitBaseline?: GitBaseline, private readonly gitRunner?: GitCommandRunner
  ) {}

  async review(taskId: string, signal?: AbortSignal): Promise<ReviewRecord> {
    const context = await collectReviewContext(this.workspaceRoot, taskId, this.taskState, this.executions, this.research, this.documentation, signal, this.gitBaseline, this.gitRunner);
    const contextFingerprint = this.store.contextFingerprint(taskId);
    const analysis = await this.analyzer.analyze(context, signal);
    const review: ReviewRecord = {
      id: randomUUID(), taskId, iteration: this.store.read(taskId).length + 1, contextFingerprint,
      status: analysis.findings.length ? 'pending-manager-evaluation' : 'approved', summary: analysis.summary,
      findings: analysis.findings.map(finding => ({ ...finding, id: randomUUID() })), createdAt: new Date().toISOString()
    };
    this.store.write(review); return review;
  }

  evaluate(taskId: string, reviewId: string, dispositions: FindingDisposition[]): ReviewRecord {
    const review = this.store.read(taskId).find(item => item.id === reviewId);
    if (!review) throw new Error('Review was not found.');
    if (!this.store.isCurrent(review)) throw new Error('Review context is stale; run a fresh independent review.');
    if (review.status !== 'pending-manager-evaluation') throw new Error('Review is not awaiting Manager evaluation.');
    if (dispositions.length !== review.findings.length || new Set(dispositions.map(item => item.findingId)).size !== review.findings.length
      || dispositions.some(item => !review.findings.some(finding => finding.id === item.findingId) || !['confirmed', 'dismissed'].includes(item.decision) || !item.rationale.trim())) throw new Error('Manager must evaluate every finding exactly once with a rationale.');
    review.dispositions = dispositions.map(item => ({ ...item, rationale: item.rationale.trim().slice(0, 2_000) }));
    const confirmed = review.dispositions.filter(item => item.decision === 'confirmed');
    review.status = confirmed.length ? 'changes-requested' : 'approved'; review.evaluatedAt = new Date().toISOString();
    this.store.write(review);
    if (confirmed.length) {
      const state = this.taskState.read(taskId);
      if (!state) throw new Error('Task state was not initialized.');
      const byId = new Map(review.findings.map(finding => [finding.id, finding]));
      this.taskState.update(taskId, { remainingWork: [...state.remainingWork, ...confirmed.map(item => `Reviewer: ${byId.get(item.findingId)?.recommendedAction ?? item.rationale}`)] });
    }
    return review;
  }
}
