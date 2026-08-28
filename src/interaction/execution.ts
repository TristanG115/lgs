import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ActivityEvent, ActivityEventType, ActivityStatus, ExecutionMode, RequestExecution, RequestStatus, WorkPhase } from './types.js';

type PhaseTemplate = Pick<WorkPhase, 'id' | 'name' | 'goal' | 'profileId'>;
const BASE_PHASES: PhaseTemplate[] = [
  { id: 'understand', name: 'Understand request', goal: 'Establish the requested outcome and constraints', profileId: 'manager' },
  { id: 'inspect', name: 'Inspect system', goal: 'Locate relevant repository and runtime evidence', profileId: 'researcher' },
  { id: 'plan', name: 'Plan', goal: 'Define the implementation and verification approach', profileId: 'planner' },
  { id: 'implement', name: 'Implement', goal: 'Apply the required changes', profileId: 'implementer' },
  { id: 'verify', name: 'Verify', goal: 'Test the result against the requested outcome', profileId: 'verifier' },
];

export interface ActivityStore {
  saveRequest(request: RequestExecution): void;
  append(event: ActivityEvent): void;
  request(id: string): RequestExecution | undefined;
  events(id: string): ActivityEvent[];
}

export class FileActivityStore implements ActivityStore {
  constructor(private readonly root: string) {}
  saveRequest(request: RequestExecution): void { const file = this.requestFile(request.id); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(request, null, 2) + '\n', 'utf8'); }
  append(event: ActivityEvent): void { const file = this.eventFile(event.requestId); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, JSON.stringify(event) + '\n', 'utf8'); }
  request(id: string): RequestExecution | undefined { try { return JSON.parse(fs.readFileSync(this.requestFile(id), 'utf8')) as RequestExecution; } catch { return; } }
  events(id: string): ActivityEvent[] { try { return fs.readFileSync(this.eventFile(id), 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as ActivityEvent); } catch { return []; } }
  private requestFile(id: string): string { return path.join(this.root, '.lgs', 'tasks', safeId(id), 'request.json'); }
  private eventFile(id: string): string { return path.join(this.root, '.lgs', 'tasks', safeId(id), 'activity.jsonl'); }
}

export class MemoryActivityStore implements ActivityStore {
  private requests = new Map<string, RequestExecution>(); private entries = new Map<string, ActivityEvent[]>();
  saveRequest(request: RequestExecution): void { this.requests.set(request.id, structuredClone(request)); }
  append(event: ActivityEvent): void { this.entries.set(event.requestId, [...(this.entries.get(event.requestId) || []), structuredClone(event)]); }
  request(id: string): RequestExecution | undefined { const value = this.requests.get(id); return value && structuredClone(value); }
  events(id: string): ActivityEvent[] { return structuredClone(this.entries.get(id) || []); }
}

export class RequestExecutionService {
  private active = new Map<string, RequestExecution>();
  constructor(private readonly store: ActivityStore, private readonly changed: (request: RequestExecution, event?: ActivityEvent) => void = () => {}) {}
  start(id: string, objective: string, mode: ExecutionMode, at = now()): RequestExecution {
    const allowed = mode === 'plan' ? new Set(['understand', 'inspect', 'plan']) : mode === 'web' ? new Set(['understand', 'inspect', 'verify']) : undefined;
    const phases = BASE_PHASES.filter(phase => !allowed || allowed.has(phase.id)).map(phase => ({ ...phase, status: 'pending' as const }));
    const request: RequestExecution = { id, objective, mode, status: 'active', startedAt: at, phases }; this.active.set(id, request); this.store.saveRequest(request);
    this.event(id, 'request', 'Request started', { status: 'started' }, at); this.startPhase(id, phases[0].id, at); return this.snapshot(request);
  }
  current(id: string): RequestExecution | undefined { const value = this.active.get(id) || this.store.request(id); return value && this.snapshot(value); }
  startPhase(id: string, phaseId: string, at = now()): WorkPhase {
    const request = this.required(id); const phase = requiredPhase(request, phaseId);
    for (const item of request.phases) if (item.status === 'active' && item.id !== phaseId) this.finishPhase(id, item.id, 'completed', undefined, at);
    phase.status = 'active'; phase.startedAt ||= at; this.persist(request); this.event(id, 'phase', `Phase started: ${phase.name}`, { phaseId, status: 'started' }, at); return { ...phase };
  }
  finishPhase(id: string, phaseId: string, status: Exclude<WorkPhase['status'], 'pending' | 'active'> = 'completed', result?: string, at = now()): WorkPhase {
    const request = this.required(id); const phase = requiredPhase(request, phaseId); phase.status = status; phase.startedAt ||= at; phase.endedAt = at; phase.result = result; this.persist(request);
    this.event(id, 'phase', `Phase ${status}: ${phase.name}`, { phaseId, status: status === 'failed' ? 'failed' : status === 'blocked' ? 'blocked' : 'success', detail: result }, at); return { ...phase };
  }
  event(id: string, type: ActivityEventType, summary: string, options: { phaseId?: string; detail?: string; status?: ActivityStatus; resource?: ActivityEvent['resource']; metadata?: ActivityEvent['metadata'] } = {}, at = now()): ActivityEvent {
    const event: ActivityEvent = { id: randomUUID(), requestId: id, timestamp: at, type, summary, ...options }; this.store.append(event); const request = this.required(id); this.changed(this.snapshot(request), event); return event;
  }
  finish(id: string, status: Exclude<RequestStatus, 'active'>, result?: string, at = now()): RequestExecution {
    const request = this.required(id); const active = request.phases.find(phase => phase.status === 'active');
    if (active) this.finishPhase(id, active.id, status === 'completed' ? 'completed' : status === 'waiting-for-user' ? 'blocked' : status === 'stopped' ? 'skipped' : 'failed', result, at);
    for (const phase of request.phases) if (phase.status === 'pending') { phase.status = 'skipped'; phase.endedAt = at; }
    request.status = status; request.endedAt = at; this.persist(request); this.event(id, 'request', `Request ${status}`, { status: status === 'completed' ? 'success' : status === 'waiting-for-user' ? 'blocked' : 'failed', detail: result }, at); this.active.delete(id); return this.snapshot(request);
  }
  events(id: string): ActivityEvent[] { return this.store.events(id); }
  private required(id: string): RequestExecution { const request = this.active.get(id) || this.store.request(id); if (!request) throw new Error(`Request execution was not found: ${id}`); this.active.set(id, request); return request; }
  private persist(request: RequestExecution): void { this.store.saveRequest(request); this.changed(this.snapshot(request)); }
  private snapshot(request: RequestExecution): RequestExecution { return { ...request, phases: request.phases.map(phase => ({ ...phase })) }; }
}

function requiredPhase(request: RequestExecution, id: string): WorkPhase { const phase = request.phases.find(item => item.id === id); if (!phase) throw new Error(`Request phase was not found: ${id}`); return phase; }
function safeId(value: string): string { if (!/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error('Unsafe request ID.'); return value; }
function now(): string { return new Date().toISOString(); }
