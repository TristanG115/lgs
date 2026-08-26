import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TaskState } from './types.js';

export class FileTaskStateStore {
  constructor(private readonly workspaceRoot: string) {}

  ensure(taskId: string, objective: string): TaskState {
    const existing = this.read(taskId);
    if (existing) return existing;
    validateTaskId(taskId);
    const now = new Date().toISOString();
    const state: TaskState = { taskId, objective: bounded(objective, 4_000), acceptanceCriteria: [], currentPlan: [], completedWork: [], remainingWork: [], recentModifications: [], revision: 0, createdAt: now, updatedAt: now };
    this.write(state); return clone(state);
  }

  read(taskId: string): TaskState | undefined {
    if (!validTaskId(taskId)) return;
    try { const value = JSON.parse(fs.readFileSync(this.file(taskId), 'utf8')) as unknown; return validState(value) ? clone(value) : undefined; }
    catch { return; }
  }

  update(taskId: string, patch: Partial<Pick<TaskState, 'acceptanceCriteria' | 'currentPlan' | 'completedWork' | 'remainingWork' | 'recentModifications' | 'commitSha' | 'explicitUncertainty'>>): TaskState {
    const current = this.read(taskId);
    if (!current) throw new Error('Task state was not initialized.');
    for (const key of ['acceptanceCriteria', 'currentPlan', 'completedWork', 'remainingWork', 'recentModifications'] as const) {
      const candidate = patch[key];
      if (candidate !== undefined) current[key] = boundedList(candidate);
    }
    if ('commitSha' in patch) current.commitSha = patch.commitSha ? validateCommitSha(patch.commitSha) : undefined;
    if ('explicitUncertainty' in patch) current.explicitUncertainty = patch.explicitUncertainty ? bounded(patch.explicitUncertainty, 2_000) : undefined;
    current.revision++; current.updatedAt = new Date().toISOString(); this.write(current); return clone(current);
  }

  private file(taskId: string): string { return path.join(this.workspaceRoot, '.lgs', 'tasks', taskId, 'state.json'); }
  private write(state: TaskState): void { const file = this.file(state.taskId); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n'); }
}

function boundedList(values: string[]): string[] {
  if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) throw new Error('Task state lists must contain strings.');
  return [...new Set(values.map(value => bounded(value, 1_000)).filter(Boolean))].slice(0, 100);
}
function bounded(value: string, maximum: number): string { return String(value).trim().slice(0, maximum); }
function validateCommitSha(value: string): string {
  const sha = bounded(value, 64);
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error('Commit SHA must be a 40-character hexadecimal Git object ID.');
  return sha;
}
function validTaskId(value: string): boolean { return /^[a-zA-Z0-9._-]{1,128}$/.test(value); }
function validateTaskId(value: string): void { if (!validTaskId(value)) throw new Error('Task ID contains unsupported characters.'); }
function clone(state: TaskState): TaskState { return { ...state, acceptanceCriteria: [...state.acceptanceCriteria], currentPlan: [...state.currentPlan], completedWork: [...state.completedWork], remainingWork: [...state.remainingWork], recentModifications: [...state.recentModifications] }; }
function validState(value: unknown): value is TaskState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return typeof state.taskId === 'string' && typeof state.objective === 'string' && Number.isInteger(state.revision)
    && (state.commitSha === undefined || (typeof state.commitSha === 'string' && /^[0-9a-f]{40}$/i.test(state.commitSha)))
    && ['acceptanceCriteria', 'currentPlan', 'completedWork', 'remainingWork', 'recentModifications'].every(key => Array.isArray(state[key]) && (state[key] as unknown[]).every(item => typeof item === 'string'));
}
