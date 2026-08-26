import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CompletionEvidence, CompletionRequirement } from './types.js';

export const RECORDABLE_REQUIREMENTS: CompletionRequirement[] = [
  'acceptance_criteria_addressed', 'implementation_complete', 'relevant_tests_added_or_updated',
  'documentation_current', 'independent_review_passes'
];

export class FileCompletionEvidenceStore {
  constructor(private readonly workspaceRoot: string) {}

  record(taskId: string, requirement: CompletionRequirement, summary: string, files: string[] = []): CompletionEvidence {
    validateTaskId(taskId);
    if (!RECORDABLE_REQUIREMENTS.includes(requirement)) throw new Error(`${requirement} must be established by LGS, not model-authored evidence.`);
    if (!summary.trim() || summary.length > 2_000) throw new Error('Completion evidence summary must contain 1 to 2000 characters.');
    const fingerprints = unique(files).map(file => this.fingerprint(file));
    if (['implementation_complete', 'relevant_tests_added_or_updated', 'documentation_current'].includes(requirement) && !fingerprints.length) throw new Error(`${requirement} evidence must name at least one file.`);
    const evidence: CompletionEvidence = {
      id: randomUUID(), requirement, summary: summary.trim(), recordedAt: new Date().toISOString(), source: 'task-record', files: fingerprints.length ? fingerprints : undefined
    };
    const entries = this.read(taskId); entries.push(evidence); this.write(taskId, entries);
    return evidence;
  }

  read(taskId: string): CompletionEvidence[] {
    if (!validTaskId(taskId)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file(taskId), 'utf8')) as unknown;
      return Array.isArray(parsed) ? parsed.filter(validEvidence) : [];
    } catch { return []; }
  }

  isCurrent(evidence: CompletionEvidence): boolean {
    return (evidence.files ?? []).every(file => {
      try { return this.fingerprint(file.path).hash === file.hash; } catch { return false; }
    });
  }

  private fingerprint(requested: string): { path: string; hash: string } {
    if (!requested || requested.includes('\0') || path.isAbsolute(requested)) throw new Error('Evidence files must be workspace-relative.');
    const root = fs.realpathSync(this.workspaceRoot);
    const candidate = path.resolve(root, requested);
    const relative = path.relative(root, candidate);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Evidence file escapes the workspace.');
    const real = fs.realpathSync(candidate);
    const realRelative = path.relative(root, real);
    if (realRelative === '..' || realRelative.startsWith('..' + path.sep) || path.isAbsolute(realRelative) || !fs.statSync(real).isFile()) throw new Error('Evidence path must be a workspace file.');
    return { path: realRelative.split(path.sep).join('/'), hash: createHash('sha256').update(fs.readFileSync(real)).digest('hex') };
  }

  private file(taskId: string): string { return path.join(this.workspaceRoot, '.lgs', 'tasks', taskId, 'completion-evidence.json'); }
  private write(taskId: string, evidence: CompletionEvidence[]): void { const file = this.file(taskId); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(evidence, null, 2) + '\n'); }
}

function validTaskId(taskId: string): boolean { return /^[a-zA-Z0-9._-]{1,128}$/.test(taskId); }
function validateTaskId(taskId: string): void { if (!validTaskId(taskId)) throw new Error('Task ID contains unsupported characters.'); }
function unique(values: string[]): string[] { return [...new Set(values)]; }
function validEvidence(value: unknown): value is CompletionEvidence {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === 'string' && typeof entry.requirement === 'string' && typeof entry.summary === 'string' && typeof entry.recordedAt === 'string' && entry.source === 'task-record';
}
