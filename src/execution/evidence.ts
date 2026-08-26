import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ExecutionEvidence, ExecutionResult } from './types.js';

export interface TaskEvidenceSink {
  recordExecution(taskId: string, result: ExecutionResult): void | Promise<void>;
}

export class FileTaskEvidenceStore implements TaskEvidenceSink {
  constructor(private readonly workspaceRoot: string) {}

  recordExecution(taskId: string, result: ExecutionResult): void {
    if (!/^[a-zA-Z0-9._-]{1,128}$/.test(taskId)) throw new Error('Task ID contains unsupported characters.');
    const directory = path.join(this.workspaceRoot, '.lgs', 'tasks', taskId);
    const file = path.join(directory, 'evidence.json');
    fs.mkdirSync(directory, { recursive: true });
    let existing: ExecutionEvidence[] = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
      if (Array.isArray(parsed)) existing = parsed as ExecutionEvidence[];
    } catch { /* A new task has no evidence file yet. */ }
    existing.push({ kind: 'command-execution', recordedAt: new Date().toISOString(), taskId, verificationStep: result.request.verificationStep, execution: result });
    fs.writeFileSync(file, JSON.stringify(existing, null, 2) + '\n');
  }

  read(taskId: string): ExecutionEvidence[] {
    if (!/^[a-zA-Z0-9._-]{1,128}$/.test(taskId)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(this.workspaceRoot, '.lgs', 'tasks', taskId, 'evidence.json'), 'utf8')) as unknown;
      return Array.isArray(parsed) ? parsed as ExecutionEvidence[] : [];
    } catch { return []; }
  }
}

