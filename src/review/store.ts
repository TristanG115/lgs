import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FileDocumentationAuditStore } from '../documentation/store.js';
import type { FileTaskEvidenceStore } from '../execution/evidence.js';
import type { FileResearchStore } from '../research/store.js';
import { REVIEW_CONFIDENCES, REVIEW_SEVERITIES, type IndependentReviewReader, type ReviewRecord } from './types.js';

export class FileReviewStore implements IndependentReviewReader {
  constructor(
    private readonly workspaceRoot: string,
    private readonly documentation: FileDocumentationAuditStore,
    private readonly executions: FileTaskEvidenceStore,
    private readonly research: FileResearchStore
  ) {}

  read(taskId: string): ReviewRecord[] {
    if (!validTaskId(taskId)) return [];
    try { const value = JSON.parse(fs.readFileSync(this.file(taskId), 'utf8')) as unknown; return Array.isArray(value) ? value.filter(validReview) : []; }
    catch { return []; }
  }
  latest(taskId: string): ReviewRecord | undefined { return this.read(taskId).at(-1); }
  write(review: ReviewRecord): void {
    if (!validTaskId(review.taskId)) throw new Error('Task ID contains unsupported characters.');
    const entries = this.read(review.taskId); const index = entries.findIndex(item => item.id === review.id);
    if (index >= 0) entries[index] = review; else entries.push(review);
    const file = this.file(review.taskId); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(entries.slice(-50), null, 2) + '\n');
  }
  isCurrent(review: ReviewRecord): boolean { return review.contextFingerprint === this.contextFingerprint(review.taskId); }
  contextFingerprint(taskId: string): string {
    const hash = createHash('sha256');
    hash.update(this.documentation.contextFingerprint(taskId));
    hash.update(JSON.stringify(this.executions.read(taskId)));
    hash.update(JSON.stringify(this.research.read(taskId)));
    hash.update(JSON.stringify(this.documentation.read(taskId) ?? null));
    return hash.digest('hex');
  }
  private file(taskId: string): string { return path.join(this.workspaceRoot, '.lgs', 'tasks', taskId, 'reviews.json'); }
}

function validTaskId(value: string): boolean { return /^[a-zA-Z0-9._-]{1,128}$/.test(value); }
function validReview(value: unknown): value is ReviewRecord {
  if (!record(value)) return false;
  return typeof value.id === 'string' && typeof value.taskId === 'string' && Number.isInteger(value.iteration)
    && typeof value.contextFingerprint === 'string' && ['pending-manager-evaluation', 'changes-requested', 'approved'].includes(value.status as string)
    && typeof value.summary === 'string' && typeof value.createdAt === 'string' && Array.isArray(value.findings)
    && value.findings.every(finding => record(finding) && typeof finding.id === 'string' && REVIEW_SEVERITIES.includes(finding.severity as never)
      && REVIEW_CONFIDENCES.includes(finding.confidence as never) && ['location', 'description', 'evidence', 'recommendedAction'].every(key => typeof finding[key] === 'string'));
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
