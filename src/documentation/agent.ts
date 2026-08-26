import { randomUUID } from 'node:crypto';
import type { GitCommandRunner } from '../tools/git.js';
import type { FileTaskStateStore } from '../watchdog/state.js';
import { collectDocumentationContext, codebaseMapIsCurrent } from './context.js';
import type { DocumentationAnalyzer, DocumentationAudit } from './types.js';
import { FileDocumentationAuditStore } from './store.js';

export class DocumentationAgent {
  constructor(
    private readonly workspaceRoot: string,
    private readonly taskState: FileTaskStateStore,
    private readonly analyzer: DocumentationAnalyzer,
    private readonly store: FileDocumentationAuditStore,
    private readonly gitRunner?: GitCommandRunner
  ) {}

  async audit(taskId: string, signal?: AbortSignal): Promise<DocumentationAudit> {
    const state = this.taskState.read(taskId);
    if (!state) throw new Error('Task state was not initialized.');
    const context = await collectDocumentationContext(this.workspaceRoot, state, signal, this.gitRunner);
    const contextFingerprint = this.store.contextFingerprint(taskId);
    const analysis = await this.analyzer.analyze(context, signal);
    const map = analysis.assessments.find(item => item.category === 'codebase-map')!;
    const mapCurrent = codebaseMapIsCurrent(this.workspaceRoot);
    map.status = mapCurrent ? 'current' : 'stale';
    map.reason = mapCurrent ? 'Repository index and CODEBASE_MAP match the workspace.' : 'Repository index or CODEBASE_MAP is stale for the current workspace.';
    map.affectedFiles = ['.lgs/CODEBASE_MAP.md'];
    const taskRecords = analysis.assessments.find(item => item.category === 'task-records')!;
    if (context.changedPaths.length && !state.recentModifications.length) {
      taskRecords.status = 'stale'; taskRecords.reason = 'The current change set is not represented in task state.'; taskRecords.affectedFiles = [];
    }
    const audit: DocumentationAudit = {
      id: randomUUID(), taskId, summary: analysis.summary, assessments: analysis.assessments,
      contextFingerprint, taskStateRevision: state.revision, changedPaths: context.changedPaths, createdAt: new Date().toISOString()
    };
    this.store.write(audit);
    return audit;
  }
}
