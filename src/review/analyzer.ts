import { randomUUID } from 'node:crypto';
import type { ModelBackend } from '../model/backend.js';
import { textMessage } from '../model/types.js';
import { REVIEW_CONFIDENCES, REVIEW_SEVERITIES, type ReviewAnalysis, type ReviewerAnalyzer, type ReviewContext, type ReviewFinding } from './types.js';

export class BackendReviewerAnalyzer implements ReviewerAnalyzer {
  constructor(private readonly backend: ModelBackend, private readonly model: string) {}

  async analyze(context: ReviewContext, signal?: AbortSignal): Promise<ReviewAnalysis> {
    const instructions = [
      'You are a fresh independent Reviewer. You did not participate in implementation.',
      'Review only the evidence supplied below. The implementation conversation is intentionally unavailable.',
      'Actively search for correctness bugs, missed requirements, regressions, edge cases, security problems, unsupported assumptions, missing or weak tests, stale docs, architecture problems, unnecessary scope, and accidental modification of user changes.',
      'Return only JSON: {"summary":"...","findings":[{"severity":"critical|high|medium|low","confidence":"high|medium|low","location":"path:line or subsystem","description":"...","evidence":"...","recommendedAction":"..."}]}',
      `Review evidence: ${JSON.stringify(context)}`
    ].join('\n');
    let output = '', failure: string | undefined;
    for await (const event of this.backend.streamChat(this.model, [textMessage('system', instructions)], { temperature: 0 }, signal)) {
      if (event.type === 'textDelta') output += event.text;
      if (event.type === 'error') failure = event.error.message;
    }
    if (failure) throw new Error(failure);
    return parseReviewAnalysis(output);
  }
}

export function parseReviewAnalysis(output: string): ReviewAnalysis {
  const start = output.indexOf('{'), end = output.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Reviewer did not return a JSON object.');
  const value = JSON.parse(output.slice(start, end + 1)) as unknown;
  if (!record(value) || typeof value.summary !== 'string' || !value.summary.trim() || !Array.isArray(value.findings)) throw new Error('Reviewer returned an invalid analysis.');
  if (value.findings.length > 100) throw new Error('Reviewer returned too many findings.');
  return { summary: bounded(value.summary, 2_000), findings: value.findings.map(parseFinding) };
}

function parseFinding(value: unknown): ReviewFinding {
  if (!record(value) || !REVIEW_SEVERITIES.includes(value.severity as never) || !REVIEW_CONFIDENCES.includes(value.confidence as never)
    || !['location', 'description', 'evidence', 'recommendedAction'].every(key => typeof value[key] === 'string' && Boolean((value[key] as string).trim()))) throw new Error('Reviewer returned an invalid finding.');
  return {
    id: randomUUID(), severity: value.severity as ReviewFinding['severity'], confidence: value.confidence as ReviewFinding['confidence'],
    location: bounded(value.location as string, 500), description: bounded(value.description as string, 2_000),
    evidence: bounded(value.evidence as string, 2_000), recommendedAction: bounded(value.recommendedAction as string, 2_000)
  };
}
function bounded(value: string, maximum: number): string { return value.trim().slice(0, maximum); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
