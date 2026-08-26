import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { discoverFiles } from '../intelligence/indexer.js';
import type { FileTaskStateStore } from '../watchdog/state.js';
import { DOCUMENTATION_CATEGORIES, type DocumentationAudit, type DocumentationAuditReader } from './types.js';

export class FileDocumentationAuditStore implements DocumentationAuditReader {
  constructor(private readonly workspaceRoot: string, private readonly taskState: FileTaskStateStore) {}

  read(taskId: string): DocumentationAudit | undefined {
    if (!validTaskId(taskId)) return;
    try { const value = JSON.parse(fs.readFileSync(this.file(taskId), 'utf8')) as unknown; return validAudit(value) ? value : undefined; }
    catch { return; }
  }

  write(audit: DocumentationAudit): void {
    if (!validTaskId(audit.taskId)) throw new Error('Task ID contains unsupported characters.');
    const file = this.file(audit.taskId); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(audit, null, 2) + '\n');
  }

  isCurrent(audit: DocumentationAudit): boolean {
    const state = this.taskState.read(audit.taskId);
    return state?.revision === audit.taskStateRevision && audit.contextFingerprint === this.contextFingerprint(audit.taskId);
  }

  contextFingerprint(taskId: string): string {
    const hash = createHash('sha256');
    for (const relative of discoverFiles(this.workspaceRoot)) {
      const absolute = path.join(this.workspaceRoot, relative);
      try { hash.update(relative).update('\0').update(fs.readFileSync(absolute)).update('\0'); }
      catch { hash.update(relative).update('\0missing\0'); }
    }
    const map = path.join(this.workspaceRoot, '.lgs', 'CODEBASE_MAP.md');
    try { hash.update('.lgs/CODEBASE_MAP.md\0').update(fs.readFileSync(map)).update('\0'); }
    catch { hash.update('.lgs/CODEBASE_MAP.md\0missing\0'); }
    const state = this.taskState.read(taskId);
    hash.update(JSON.stringify(state ?? null));
    return hash.digest('hex');
  }

  private file(taskId: string): string { return path.join(this.workspaceRoot, '.lgs', 'tasks', taskId, 'documentation-audit.json'); }
}

function validTaskId(value: string): boolean { return /^[a-zA-Z0-9._-]{1,128}$/.test(value); }
function validAudit(value: unknown): value is DocumentationAudit {
  if (!record(value)) return false;
  return typeof value.id === 'string' && typeof value.taskId === 'string' && typeof value.contextFingerprint === 'string'
    && Number.isInteger(value.taskStateRevision) && typeof value.summary === 'string' && typeof value.createdAt === 'string'
    && Array.isArray(value.changedPaths) && value.changedPaths.every(item => typeof item === 'string')
    && Array.isArray(value.assessments) && value.assessments.length === DOCUMENTATION_CATEGORIES.length
    && value.assessments.every(item => record(item) && DOCUMENTATION_CATEGORIES.includes(item.category as never)
      && ['current', 'stale', 'not-applicable'].includes(item.status as string) && typeof item.reason === 'string'
      && Array.isArray(item.affectedFiles) && item.affectedFiles.every(file => typeof file === 'string'));
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
