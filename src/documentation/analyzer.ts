import type { ModelBackend } from '../model/backend.js';
import { textMessage } from '../model/types.js';
import { DOCUMENTATION_CATEGORIES, type DocumentationAnalysis, type DocumentationAnalyzer, type DocumentationAssessment, type DocumentationContext } from './types.js';

export class BackendDocumentationAnalyzer implements DocumentationAnalyzer {
  constructor(private readonly backend: ModelBackend, private readonly model: string) {}

  async analyze(context: DocumentationContext, signal?: AbortSignal): Promise<DocumentationAnalysis> {
    let output = '', failure: string | undefined;
    const prompt = [
      'You are the DocumentationAgent. Audit documentation after a meaningful engineering change.',
      'Determine which documentation is stale. Do not request comments that merely restate obvious code.',
      'Return only JSON with summary and one assessment for every category.',
      `Categories: ${DOCUMENTATION_CATEGORIES.join(', ')}`,
      'Each assessment must be {"category":"...","status":"current|stale|not-applicable","reason":"...","affectedFiles":["..."]}.',
      `Documentation context: ${JSON.stringify(context)}`
    ].join('\n');
    for await (const event of this.backend.streamChat(this.model, [textMessage('system', prompt)], { temperature: 0 }, signal)) {
      if (event.type === 'textDelta') output += event.text;
      if (event.type === 'error') failure = event.error.message;
    }
    if (failure) throw new Error(failure);
    return parseDocumentationAnalysis(output);
  }
}

export class RuleBasedDocumentationAnalyzer implements DocumentationAnalyzer {
  async analyze(context: DocumentationContext): Promise<DocumentationAnalysis> {
    const meaningful = context.changedPaths.some(path => /^(?:src|test|lib|app)\/|(?:package(?:-lock)?\.json|\.lgs\/config\.yaml)$/.test(path));
    const documentation = context.changedPaths.filter(path => /(?:README|docs?\/|ARCHITECTURE|\.md$)/i.test(path));
    const hasDocs = documentation.length > 0;
    const kinds = new Set(context.changeKinds);
    const assessments: DocumentationAssessment[] = DOCUMENTATION_CATEGORIES.map(category => {
      if (category === 'codebase-map') return assessment(category, 'current', 'Repository Intelligence verifies CODEBASE_MAP freshness separately.', ['.lgs/CODEBASE_MAP.md']);
      if (category === 'task-records') return assessment(category, context.taskState.recentModifications.length ? 'current' : meaningful ? 'stale' : 'not-applicable', context.taskState.recentModifications.length ? 'Task state records the recent modifications.' : 'Meaningful changes are not reflected in task state.', []);
      if (category === 'inline-comments') return assessment(category, 'not-applicable', 'Inline comments are required only for non-obvious behavior; obvious code should remain uncommented.', []);
      const required = category === 'developer' && meaningful
        || category === 'architecture' && ['file-creation', 'file-deletion', 'file-rename', 'responsibility-change', 'interface-change'].some(kind => kinds.has(kind))
        || category === 'configuration' && (kinds.has('configuration-change') || kinds.has('dependency-change'))
        || category === 'api' && kinds.has('interface-change')
        || category === 'user-facing' && meaningful;
      return assessment(category, required ? hasDocs ? 'current' : 'stale' : 'not-applicable', required ? hasDocs ? `Changed documentation addresses the affected ${category} surface.` : `The ${category} documentation surface may be affected but no documentation file changed.` : `No ${category} documentation impact was detected.`, documentation);
    });
    return { summary: assessments.some(item => item.status === 'stale') ? 'Documentation updates are required.' : 'Affected documentation is current.', assessments };
  }
}

export function parseDocumentationAnalysis(output: string): DocumentationAnalysis {
  const start = output.indexOf('{'), end = output.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('DocumentationAgent did not return a JSON object.');
  const value = JSON.parse(output.slice(start, end + 1)) as unknown;
  if (!record(value) || typeof value.summary !== 'string' || !Array.isArray(value.assessments)) throw new Error('DocumentationAgent returned an invalid analysis.');
  const assessments = value.assessments.flatMap(parseAssessment);
  if (assessments.length !== DOCUMENTATION_CATEGORIES.length || new Set(assessments.map(item => item.category)).size !== DOCUMENTATION_CATEGORIES.length) throw new Error('DocumentationAgent must assess every documentation category exactly once.');
  return { summary: value.summary.trim().slice(0, 2_000), assessments: DOCUMENTATION_CATEGORIES.map(category => assessments.find(item => item.category === category)!) };
}
function parseAssessment(value: unknown): DocumentationAssessment[] {
  if (!record(value) || !DOCUMENTATION_CATEGORIES.includes(value.category as never) || !['current', 'stale', 'not-applicable'].includes(value.status as string) || typeof value.reason !== 'string' || !Array.isArray(value.affectedFiles) || value.affectedFiles.some(file => typeof file !== 'string')) return [];
  return [{ category: value.category as DocumentationAssessment['category'], status: value.status as DocumentationAssessment['status'], reason: value.reason.trim().slice(0, 1_000), affectedFiles: [...new Set(value.affectedFiles as string[])].slice(0, 100) }];
}
function assessment(category: DocumentationAssessment['category'], status: DocumentationAssessment['status'], reason: string, affectedFiles: string[]): DocumentationAssessment { return { category, status, reason, affectedFiles }; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
