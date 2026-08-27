import { randomUUID } from 'node:crypto';
import { textMessage, type LgsMessage } from '../model/types.js';
import { compactWorkerReports, parseWorkerReport } from './report.js';
import { InferenceScheduler } from './scheduler.js';
import type {
  AgentAccess, AgentDescriptor, AgentInference, AgentModelIdentity, AgentSubtask, CreateAgentRequest,
  DelegatedResult, DelegatedSubtask, OrchestrationConfiguration, WorkerReport
} from './types.js';

type AgentSession = AgentDescriptor & { context: LgsMessage[]; controller?: AbortController };

const DEFAULT_ACCESS: Record<CreateAgentRequest['role'], AgentAccess> = {
  manager: 'write', explorer: 'read-only', researcher: 'read-only', implementer: 'write',
  'test-engineer': 'write', 'documentation-agent': 'write', reviewer: 'read-only', debugger: 'write', verifier: 'read-only',
  'official-docs-researcher': 'read-only', 'source-researcher': 'read-only', 'experiment-implementer': 'write',
  'result-analyzer': 'read-only', 'research-supervisor': 'read-only'
};

export class Orchestrator {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly scheduler: InferenceScheduler;

  constructor(
    private readonly inference: AgentInference,
    private readonly configuration: OrchestrationConfiguration,
    private readonly managerModel: AgentModelIdentity
  ) { this.scheduler = new InferenceScheduler(configuration.readOnlyConcurrency); }

  createAgent(request: CreateAgentRequest): AgentDescriptor {
    if (request.parentId && !this.sessions.has(request.parentId)) throw new Error('Parent agent was not found.');
    const now = new Date().toISOString();
    const configured = this.configuration.roleModels[request.role];
    const session: AgentSession = {
      id: randomUUID(), role: request.role, access: request.access ?? DEFAULT_ACCESS[request.role],
      model: { profileId: configured?.profileId ?? this.managerModel.profileId, model: configured?.model ?? this.managerModel.model },
      parentId: request.parentId, state: 'created', createdAt: now, updatedAt: now,
      context: cloneMessages(request.initialContext ?? []).slice(-this.configuration.maxContextMessages)
    };
    this.sessions.set(session.id, session);
    return descriptor(session);
  }

  async assignSubtask(agentId: string, subtask: AgentSubtask, signal?: AbortSignal): Promise<WorkerReport> {
    const session = this.requireSession(agentId);
    if (session.role === 'manager') throw new Error('Manager agents receive worker reports rather than delegated subtasks.');
    if (session.state !== 'created') throw new Error(`Agent ${agentId} is already ${session.state}.`);
    if (!subtask.objective.trim() || subtask.objective.length > 4_000) throw new Error('Agent objective must contain 1 to 4000 characters.');
    const controller = new AbortController();
    session.controller = controller;
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) controller.abort();
    session.state = 'running'; this.touch(session);
    const messages = [...cloneMessages(session.context), ...cloneMessages(subtask.context ?? [])].slice(-this.configuration.maxContextMessages);
    try {
      const output = await this.scheduler.schedule(modelKey(session.model), session.access, controller.signal, () => this.inference.run({
        agentId: session.id, role: session.role, model: { ...session.model }, objective: subtask.objective.trim(), messages, signal: controller.signal
      }));
      if (controller.signal.aborted) throw abortError();
      session.report = parseWorkerReport(output);
      session.state = 'completed'; this.touch(session);
      return cloneReport(session.report);
    } catch (error) {
      session.state = controller.signal.aborted || isAbort(error) ? 'cancelled' : 'failed';
      session.error = boundedError(error); this.touch(session);
      throw error;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      session.controller = undefined;
    }
  }

  gatherReports(managerId: string, workerIds: string[]): WorkerReport[] {
    const manager = this.requireSession(managerId);
    if (manager.role !== 'manager') throw new Error('Reports can only be returned to a Manager agent.');
    const reports = workerIds.map(id => this.requireSession(id)).filter(session => session.state === 'completed' && session.report).map(session => cloneReport(session.report!));
    if (reports.length) {
      manager.context.push(textMessage('system', `Worker reports: ${compactWorkerReports(reports)}`));
      manager.context = manager.context.slice(-this.configuration.maxContextMessages);
      this.touch(manager);
    }
    return reports;
  }

  async runSubtasks(managerId: string, subtasks: DelegatedSubtask[], signal?: AbortSignal, cleanup = true): Promise<DelegatedResult[]> {
    if (subtasks.length < 1 || subtasks.length > this.configuration.maxWorkersPerBatch) throw new Error(`Delegate between 1 and ${this.configuration.maxWorkersPerBatch} subtasks per batch.`);
    const workers = subtasks.map(subtask => this.createAgent({ role: subtask.role, access: subtask.access, parentId: managerId }));
    await Promise.all(workers.map(async (worker, index) => {
      try { await this.assignSubtask(worker.id, subtasks[index], signal); }
      catch { /* State and bounded error are retained on the worker session. */ }
    }));
    this.gatherReports(managerId, workers.map(worker => worker.id));
    const results = workers.map(worker => {
      const current = this.requireSession(worker.id);
      return { agentId: current.id, role: current.role, status: current.state as DelegatedResult['status'], report: current.report ? cloneReport(current.report) : undefined, error: current.error };
    });
    if (cleanup) for (const worker of workers) this.destroyAgent(worker.id);
    return results;
  }

  cancelAgent(agentId: string): boolean {
    const session = this.sessions.get(agentId);
    if (!session || !['created', 'running'].includes(session.state)) return false;
    session.controller?.abort();
    if (session.state === 'created') { session.state = 'cancelled'; this.touch(session); }
    return true;
  }

  destroyAgent(agentId: string): boolean {
    const session = this.sessions.get(agentId);
    if (!session || session.state === 'running') return false;
    session.state = 'destroyed'; this.touch(session);
    this.sessions.delete(agentId);
    return true;
  }

  getAgent(agentId: string): AgentDescriptor | undefined { const session = this.sessions.get(agentId); return session ? descriptor(session) : undefined; }
  listAgents(): AgentDescriptor[] { return [...this.sessions.values()].map(descriptor); }

  private requireSession(agentId: string): AgentSession { const session = this.sessions.get(agentId); if (!session) throw new Error(`Agent was not found: ${agentId}.`); return session; }
  private touch(session: AgentSession): void { session.updatedAt = new Date().toISOString(); }
}

function descriptor(session: AgentSession): AgentDescriptor {
  return { id: session.id, role: session.role, access: session.access, model: { ...session.model }, parentId: session.parentId,
    state: session.state, createdAt: session.createdAt, updatedAt: session.updatedAt, report: session.report ? cloneReport(session.report) : undefined, error: session.error };
}
function cloneMessages(messages: LgsMessage[]): LgsMessage[] { return messages.map(message => ({ ...message, content: message.content.map(part => ({ ...part })) })); }
function cloneReport(report: WorkerReport): WorkerReport { return { ...report, findings: [...report.findings], relevantFiles: [...report.relevantFiles], workPerformed: [...report.workPerformed], risks: [...report.risks], unresolvedQuestions: [...report.unresolvedQuestions] }; }
function modelKey(model: AgentModelIdentity): string { return `${model.profileId}\0${model.model}`; }
function boundedError(error: unknown): string { return (error instanceof Error ? error.message : 'Agent inference failed.').slice(0, 1_000); }
function isAbort(error: unknown): boolean { return error instanceof Error && error.name === 'AbortError'; }
function abortError(): Error { const error = new Error('Agent inference was cancelled.'); error.name = 'AbortError'; return error; }
