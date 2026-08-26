import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ResearchFinding } from './types.js';

export class FileResearchStore {
  constructor(private readonly workspaceRoot: string) {}
  read(taskId: string): ResearchFinding[] {
    if (!validTaskId(taskId)) return [];
    try { const value = JSON.parse(fs.readFileSync(this.file(taskId), 'utf8')) as unknown; return Array.isArray(value) ? value.filter(validFinding) : []; }
    catch { return []; }
  }
  append(taskId: string, findings: ResearchFinding[]): void {
    if (!validTaskId(taskId)) throw new Error('Task ID contains unsupported characters.');
    const existing = this.read(taskId);
    const byId = new Map([...existing, ...findings].map(finding => [finding.id, finding]));
    const file = this.file(taskId); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify([...byId.values()].slice(-500), null, 2) + '\n');
  }
  reusable(taskId: string, queryKey: string, relevantVersion: string | undefined, maximumAgeMs: number, now = Date.now()): ResearchFinding[] {
    return this.read(taskId).filter(finding => finding.queryKey === queryKey && (relevantVersion === undefined || finding.relevantVersion === relevantVersion) && now - Date.parse(finding.retrievedAt) <= maximumAgeMs);
  }
  private file(taskId: string): string { return path.join(this.workspaceRoot, '.lgs', 'tasks', taskId, 'research.json'); }
}

function validTaskId(value: string): boolean { return /^[a-zA-Z0-9._-]{1,128}$/.test(value); }
function validFinding(value: unknown): value is ResearchFinding {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const finding = value as Record<string, unknown>;
  return typeof finding.id === 'string' && typeof finding.sourceUrl === 'string' && typeof finding.title === 'string' && typeof finding.retrievedAt === 'string' && typeof finding.finding === 'string' && typeof finding.task === 'string' && typeof finding.requestingAgent === 'string' && typeof finding.queryKey === 'string';
}
