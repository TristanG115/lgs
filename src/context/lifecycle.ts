import * as fs from 'node:fs';
import * as path from 'node:path';
import { textMessage, type LgsMessage } from '../model/types.js';
import type { AgentCheckpoint, ContextLifecycleAction, ContextLifecycleConfiguration, ContextLifecycleState } from './types.js';

export const DEFAULT_CONTEXT_LIFECYCLE: ContextLifecycleConfiguration = { softPressurePercent: 70, compactionPercent: 82, rotationPercent: 92 };

export function parseContextLifecycleConfiguration(value: unknown = undefined, errors: string[] = []): ContextLifecycleConfiguration {
  const result = { ...DEFAULT_CONTEXT_LIFECYCLE }; if (value === undefined) return result;
  if (!record(value)) { errors.push('context.lifecycle must be a YAML object.'); return result; }
  for (const key of Object.keys(value)) if (!['softPressurePercent', 'compactionPercent', 'rotationPercent'].includes(key)) errors.push(`Unknown context.lifecycle setting: ${key}.`);
  for (const key of ['softPressurePercent', 'compactionPercent', 'rotationPercent'] as const) if (value[key] !== undefined) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 1 || value[key] > 99) errors.push(`context.lifecycle.${key} must be a number from 1 to 99.`); else result[key] = value[key];
  }
  if (!(result.softPressurePercent < result.compactionPercent && result.compactionPercent < result.rotationPercent)) errors.push('Context lifecycle thresholds must increase from soft pressure to compaction to rotation.');
  return result;
}

export class ContextLifecycleManager {
  constructor(private readonly workspaceRoot: string, private readonly configuration = DEFAULT_CONTEXT_LIFECYCLE) {}
  observe(taskId: string, sessionId: string, contextTokens: number, contextMaximum: number): ContextLifecycleState {
    validateTaskId(taskId); if (!Number.isFinite(contextMaximum) || contextMaximum <= 0) throw new Error('Maximum context must be positive.');
    const prior = this.read(taskId); const utilizationPercent = rounded(Math.max(0, contextTokens) / contextMaximum * 100); const action = actionFor(utilizationPercent, this.configuration);
    const state: ContextLifecycleState = { taskId, sessionId, contextTokens: Math.max(0, Math.floor(contextTokens)), contextMaximum: Math.floor(contextMaximum), utilizationPercent, action, compactionStatus: action === 'compact' ? 'requested' : prior?.compactionStatus ?? 'none', rotations: prior?.rotations ?? 0, persistentKnowledgeBytes: knowledgeBytes(this.workspaceRoot, taskId), compactedTokensSaved: prior?.compactedTokensSaved ?? 0, updatedAt: new Date().toISOString(), checkpoint: prior?.checkpoint };
    this.write(state); return clone(state);
  }
  compact(taskId: string, completedHistoryTokens: number): ContextLifecycleState {
    const state = this.require(taskId); state.compactionStatus = 'completed'; state.compactedTokensSaved += Math.max(0, Math.floor(completedHistoryTokens)); state.updatedAt = new Date().toISOString(); this.write(state); return clone(state);
  }
  checkpoint(taskId: string, checkpoint: AgentCheckpoint): ContextLifecycleState {
    validateCheckpoint(taskId, checkpoint); const state = this.read(taskId) ?? this.observe(taskId, checkpoint.sessionId, 0, 1); state.checkpoint = clone(checkpoint); state.updatedAt = new Date().toISOString(); this.write(state); return clone(state);
  }
  rotate(taskId: string, freshSessionId: string): ContextLifecycleState {
    const state = this.require(taskId); if (!state.checkpoint) throw new Error('Context rotation requires a validated checkpoint.');
    state.sessionId = bounded(freshSessionId, 128); state.contextTokens = 0; state.utilizationPercent = 0; state.action = 'normal'; state.compactionStatus = 'none'; state.rotations++; state.updatedAt = new Date().toISOString(); this.write(state); return clone(state);
  }
  reconstruct(taskId: string): LgsMessage[] {
    const checkpoint = this.require(taskId).checkpoint; if (!checkpoint) throw new Error('A checkpoint is required to reconstruct context.');
    return [textMessage('system', ['Persistent task checkpoint:', `Facts: ${checkpoint.establishedFacts.join(' | ')}`, `Decisions: ${checkpoint.decisions.join(' | ')}`, `Hypothesis: ${checkpoint.currentHypothesis}`, `Experiment: ${checkpoint.experimentState}`, `Modified files: ${checkpoint.modifiedFiles.join(', ')}`, `Failed approaches: ${checkpoint.failedApproaches.join(' | ')}`, `Unresolved: ${checkpoint.unresolvedQuestions.join(' | ')}`, `Acceptance: ${checkpoint.acceptanceStatus.join(' | ')}`, `Next action: ${checkpoint.nextRecommendedAction}`].join('\n').slice(0, 12_000))];
  }
  read(taskId: string): ContextLifecycleState | undefined { if (!validTaskId(taskId)) return; try { const value = JSON.parse(fs.readFileSync(this.file(taskId), 'utf8')) as ContextLifecycleState; return value && typeof value.taskId === 'string' ? clone(value) : undefined; } catch { return; } }
  private require(taskId: string): ContextLifecycleState { const value = this.read(taskId); if (!value) throw new Error('Context lifecycle state was not found.'); return value; }
  private file(taskId: string): string { return path.join(this.workspaceRoot, '.lgs', 'tasks', taskId, 'context-lifecycle.json'); }
  private write(value: ContextLifecycleState): void { const file = this.file(value.taskId); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }
}

function actionFor(percent: number, value: ContextLifecycleConfiguration): ContextLifecycleAction { return percent >= value.rotationPercent ? 'rotate' : percent >= value.compactionPercent ? 'compact' : percent >= value.softPressurePercent ? 'retrieval-discipline' : 'normal'; }
function validateCheckpoint(taskId: string, value: AgentCheckpoint): void {
  if (value.taskId !== taskId || !value.sessionId || !value.currentHypothesis.trim() || !value.experimentState.trim() || !value.nextRecommendedAction.trim()) throw new Error('Checkpoint must include task/session identity, current hypothesis, experiment state, and next action.');
  for (const key of ['establishedFacts', 'decisions', 'modifiedFiles', 'failedApproaches', 'unresolvedQuestions', 'acceptanceStatus'] as const) if (!Array.isArray(value[key])) throw new Error(`Checkpoint ${key} must be an array.`);
}
function knowledgeBytes(root: string, taskId: string): number { try { return fs.readdirSync(path.join(root, '.lgs', 'tasks', taskId)).reduce((sum, name) => sum + fs.statSync(path.join(root, '.lgs', 'tasks', taskId, name)).size, 0); } catch { return 0; } }
function validTaskId(value: string): boolean { return /^[a-zA-Z0-9._-]{1,128}$/.test(value); }
function validateTaskId(value: string): void { if (!validTaskId(value)) throw new Error('Task ID contains unsupported characters.'); }
function bounded(value: string, maximum: number): string { return String(value ?? '').trim().slice(0, maximum); }
function rounded(value: number): number { return Math.round(value * 100) / 100; }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function record(value: unknown): value is Record<string, number> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
