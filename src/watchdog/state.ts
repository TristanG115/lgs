import * as fs from 'node:fs';
import * as path from 'node:path';
import { TASK_PROFILES, type TaskProfile, type TaskState } from './types.js';

export class FileTaskStateStore {
  constructor(private readonly workspaceRoot: string) {}

  ensure(taskId: string, objective: string): TaskState {
    const existing = this.read(taskId);
    if (existing) return existing;
    validateTaskId(taskId);
    const now = new Date().toISOString();
    const state: TaskState = { taskId, objective: bounded(objective, 4_000), acceptanceCriteria: [], currentPlan: [], completedWork: [], remainingWork: [], recentModifications: [], verifiedFacts: [], designDecisions: [], failedApproaches: [], blockers: [], revision: 0, createdAt: now, updatedAt: now };
    this.write(state); return clone(state);
  }

  read(taskId: string): TaskState | undefined {
    if (!validTaskId(taskId)) return;
    try { const value = JSON.parse(fs.readFileSync(this.file(taskId), 'utf8')) as unknown; return validState(value) ? clone(value) : undefined; }
    catch { return; }
  }

  compactSummary(taskId: string): string | undefined {
    const state = this.read(taskId); if (!state) return;
    const section = (label: string, values: string[]) => values.length ? `${label}: ${values.slice(0, 12).join(' | ')}` : undefined;
    return [
      `Objective: ${state.objective}`,
      section('Verified facts', state.verifiedFacts), section('Design decisions', state.designDecisions),
      section('Modifications', state.recentModifications), section('Failed approaches', state.failedApproaches),
      section('Blockers', state.blockers), section('Remaining work', state.remainingWork)
    ].filter((value): value is string => Boolean(value)).join('\n').slice(0, 8_000);
  }

  update(taskId: string, patch: Partial<Pick<TaskState, 'profile' | 'acceptanceCriteria' | 'currentPlan' | 'completedWork' | 'remainingWork' | 'recentModifications' | 'verifiedFacts' | 'designDecisions' | 'failedApproaches' | 'blockers' | 'commitSha' | 'explicitUncertainty'>>): TaskState {
    const current = this.read(taskId);
    if (!current) throw new Error('Task state was not initialized.');
    for (const key of ['acceptanceCriteria', 'currentPlan', 'completedWork', 'remainingWork', 'recentModifications', 'verifiedFacts', 'designDecisions', 'failedApproaches', 'blockers'] as const) {
      const candidate = patch[key];
      if (candidate !== undefined) current[key] = boundedList(candidate);
    }
    if ('commitSha' in patch) current.commitSha = patch.commitSha ? validateCommitSha(patch.commitSha) : undefined;
    if ('profile' in patch) current.profile = patch.profile ? validateProfile(patch.profile) : undefined;
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
function validateProfile(value: TaskProfile): TaskProfile { if (!TASK_PROFILES.includes(value)) throw new Error('Task profile is invalid.'); return value; }
function validTaskId(value: string): boolean { return /^[a-zA-Z0-9._-]{1,128}$/.test(value); }
function validateTaskId(value: string): void { if (!validTaskId(value)) throw new Error('Task ID contains unsupported characters.'); }
function clone(state: TaskState): TaskState { return { ...state, acceptanceCriteria: [...state.acceptanceCriteria], currentPlan: [...state.currentPlan], completedWork: [...state.completedWork], remainingWork: [...state.remainingWork], recentModifications: [...state.recentModifications], verifiedFacts: [...(state.verifiedFacts ?? [])], designDecisions: [...(state.designDecisions ?? [])], failedApproaches: [...(state.failedApproaches ?? [])], blockers: [...(state.blockers ?? [])] }; }
function validState(value: unknown): value is TaskState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return typeof state.taskId === 'string' && typeof state.objective === 'string' && Number.isInteger(state.revision)
    && (state.commitSha === undefined || (typeof state.commitSha === 'string' && /^[0-9a-f]{40}$/i.test(state.commitSha)))
    && (state.profile === undefined || TASK_PROFILES.includes(state.profile as TaskProfile))
    && ['acceptanceCriteria', 'currentPlan', 'completedWork', 'remainingWork', 'recentModifications'].every(key => Array.isArray(state[key]) && (state[key] as unknown[]).every(item => typeof item === 'string'))
    && ['verifiedFacts', 'designDecisions', 'failedApproaches', 'blockers'].every(key => state[key] === undefined || Array.isArray(state[key]) && (state[key] as unknown[]).every(item => typeof item === 'string'));
}
