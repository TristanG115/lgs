import type { WorkerReport } from './types.js';

const ARRAY_FIELDS = ['findings', 'relevantFiles', 'workPerformed', 'risks', 'unresolvedQuestions'] as const;

export function parseWorkerReport(output: string): WorkerReport {
  const parsed = parseObject(output);
  if (!parsed) return emptyReport(output.trim() ? ['Worker returned an invalid structured report.'] : [], 'Request a new bounded report.');
  return {
    findings: strings(parsed.findings), relevantFiles: strings(parsed.relevantFiles), workPerformed: strings(parsed.workPerformed),
    risks: strings(parsed.risks), unresolvedQuestions: strings(parsed.unresolvedQuestions),
    recommendation: typeof parsed.recommendation === 'string' && parsed.recommendation.trim() ? bounded(parsed.recommendation) : 'No recommendation was returned.'
  };
}

export function compactWorkerReports(reports: WorkerReport[]): string {
  return JSON.stringify(reports.map(report => ({
    findings: report.findings, relevantFiles: report.relevantFiles, workPerformed: report.workPerformed,
    risks: report.risks, unresolvedQuestions: report.unresolvedQuestions, recommendation: report.recommendation
  })));
}

export function emptyReport(findings: string[] = [], recommendation = ''): WorkerReport {
  return { findings, relevantFiles: [], workPerformed: [], risks: [], unresolvedQuestions: [], recommendation };
}

function parseObject(output: string): Record<string, unknown> | undefined {
  const trimmed = output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { const value = JSON.parse(trimmed) as unknown; return record(value) ? value : undefined; }
  catch { return; }
}
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()).slice(0, 20).map(item => bounded(item as string)) : []; }
function bounded(value: string): string { return value.trim().slice(0, 1_000); }
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (ARRAY_FIELDS.some(field => field in value) || 'recommendation' in value);
}
