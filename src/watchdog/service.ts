import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CompletionEvaluation, ExecutionEvidenceReader } from '../completion/types.js';
import { ruleBasedFinding } from './analyzer.js';
import { FileTaskStateStore } from './state.js';
import type { WatchdogAnalyzer, WatchdogEvaluation, WatchdogInput } from './types.js';

export class WatchdogService {
  constructor(
    private readonly workspaceRoot: string,
    private readonly taskState: FileTaskStateStore,
    private readonly executions: ExecutionEvidenceReader,
    private readonly analyzer: WatchdogAnalyzer,
    readonly intervalTurns: number
  ) {}

  async evaluate(taskId: string, completion?: CompletionEvaluation, signal?: AbortSignal): Promise<WatchdogEvaluation> {
    const state = this.taskState.read(taskId);
    if (!state) throw new Error('Task state was not initialized.');
    const previous = this.read(taskId).at(-1);
    const recentFailures = this.executions.read(taskId).map(entry => entry.execution).filter(execution => ['failed', 'spawn_error', 'timed_out'].includes(execution.status))
      .slice(-8).map(execution => execution.normalized.primaryError ?? execution.normalized.stderr[0] ?? `${execution.normalized.command} ${execution.status}`);
    const input: WatchdogInput = {
      objective: state.objective, acceptanceCriteria: [...state.acceptanceCriteria], currentPlan: [...state.currentPlan], completedWork: [...state.completedWork],
      remainingWork: unique([...state.remainingWork, ...(completion?.outstanding ?? [])]), recentModifications: [...state.recentModifications], recentFailures,
      explicitUncertainty: state.explicitUncertainty, stalled: Boolean(previous && previous.stateRevision === state.revision && (state.remainingWork.length || completion?.outstanding.length))
    };
    let finding;
    try { finding = await this.analyzer.analyze(input, signal); }
    catch { finding = ruleBasedFinding(input); }
    const evaluation: WatchdogEvaluation = { ...finding, taskId, evaluatedAt: new Date().toISOString(), stateRevision: state.revision };
    const entries = this.read(taskId); entries.push(evaluation); this.write(taskId, entries.slice(-100));
    return evaluation;
  }

  read(taskId: string): WatchdogEvaluation[] {
    if (!/^[a-zA-Z0-9._-]{1,128}$/.test(taskId)) return [];
    try { const value = JSON.parse(fs.readFileSync(this.file(taskId), 'utf8')) as unknown; return Array.isArray(value) ? value as WatchdogEvaluation[] : []; }
    catch { return []; }
  }

  private file(taskId: string): string { return path.join(this.workspaceRoot, '.lgs', 'tasks', taskId, 'watchdog.json'); }
  private write(taskId: string, entries: WatchdogEvaluation[]): void { const file = this.file(taskId); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(entries, null, 2) + '\n'); }
}

function unique(values: string[]): string[] { return [...new Set(values.filter(Boolean))].slice(0, 100); }
