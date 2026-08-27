import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GenerationOptions } from '../model/types.js';
import type { ModelBackend } from '../model/backend.js';
import { BackendToolLoopModel, type ToolLoopModel, type ToolModelTurn } from '../tools/loop.js';
import type { ToolRegistry } from '../tools/framework.js';
import type { AgentModelIdentity, ConfiguredAgentModel } from '../orchestration/types.js';
import { FileTaskStateStore } from './state.js';
import { ESCALATION_LEVELS, type EscalationLevel, type EscalationRecord, type EscalationTrigger, type WatchdogConfiguration } from './types.js';
import type { LgsMessage } from '../model/types.js';
import type { ModelRouter } from '../routing/router.js';
import type { RoutingRole } from '../routing/types.js';

export type ToolLoopBackendResolver = (profileId: string) => ModelBackend | undefined | Promise<ModelBackend | undefined>;

export class RoutedToolLoopModel implements ToolLoopModel {
  private readonly backends = new Map<string, Promise<ModelBackend>>();
  constructor(private identity: AgentModelIdentity, private readonly options: GenerationOptions, private readonly resolveBackend: ToolLoopBackendResolver) {}
  async next(messages: LgsMessage[], tools: ReturnType<ToolRegistry['specifications']>, signal: AbortSignal): Promise<ToolModelTurn> {
    const backend = await this.backend(this.identity.profileId);
    return new BackendToolLoopModel(backend, this.identity.model, this.options).next(messages, tools, signal);
  }
  switchModel(identity: AgentModelIdentity): void { this.identity = { ...identity }; }
  currentModel(): AgentModelIdentity { return { ...this.identity }; }
  private backend(profileId: string): Promise<ModelBackend> {
    let backend = this.backends.get(profileId);
    if (!backend) {
      backend = Promise.resolve(this.resolveBackend(profileId)).then(value => { if (!value) throw new Error(`Escalation provider profile was not found: ${profileId}.`); return value; });
      this.backends.set(profileId, backend);
    }
    return backend;
  }
}

export class EscalationController {
  private level: EscalationLevel;
  private identity: AgentModelIdentity;
  constructor(
    private readonly workspaceRoot: string,
    private readonly configuration: WatchdogConfiguration,
    private readonly taskState: FileTaskStateStore,
    identity: AgentModelIdentity,
    initialLevel: EscalationLevel = 'manager',
    private readonly router?: ModelRouter
  ) { this.identity = { ...identity }; this.level = initialLevel; }

  escalate(taskId: string, trigger: EscalationTrigger, reason: string): EscalationRecord {
    const revision = this.taskState.read(taskId)?.revision ?? 0;
    const existing = this.read(taskId);
    const duplicate = [...existing].reverse().find(record => record.trigger === trigger && record.taskStateRevision === revision);
    if (duplicate) return duplicate;
    const target = this.nextRoute();
    const record: EscalationRecord = {
      id: randomUUID(), taskId, trigger, reason: reason.trim().slice(0, 2_000),
      from: { level: this.level, ...this.identity },
      to: target ? { level: target.level, ...target.identity } : undefined,
      taskStateRevision: revision, createdAt: new Date().toISOString()
    };
    existing.push(record); this.write(taskId, existing);
    if (target) { this.level = target.level; this.identity = target.identity; }
    return record;
  }

  currentModel(): AgentModelIdentity { return { ...this.identity }; }
  currentLevel(): EscalationLevel { return this.level; }
  resume(taskId: string): boolean {
    const latest = this.read(taskId).at(-1)?.to;
    if (!latest) return false;
    this.level = latest.level; this.identity = { profileId: latest.profileId, model: latest.model };
    return true;
  }

  read(taskId: string): EscalationRecord[] {
    if (!/^[a-zA-Z0-9._-]{1,128}$/.test(taskId)) return [];
    try { const value = JSON.parse(fs.readFileSync(this.file(taskId), 'utf8')) as unknown; return Array.isArray(value) ? value as EscalationRecord[] : []; }
    catch { return []; }
  }

  private nextRoute(): { level: EscalationLevel; identity: AgentModelIdentity } | undefined {
    const start = ESCALATION_LEVELS.indexOf(this.level) + 1;
    for (const level of ESCALATION_LEVELS.slice(start)) {
      const configured = this.configuration.escalationRoutes[level];
      if (configured) {
        const fallback = resolveModel(configured, this.identity.profileId);
        const role: RoutingRole = level === 'cloud' ? 'cloudEscalation' : level;
        const decision = this.router?.route({ role, fallback, roleModel: configured, difficulty: level === 'difficult' || level === 'cloud' ? 'high' : 'medium', needsTools: true });
        if (decision?.blocked) continue;
        return { level, identity: decision?.identity ?? fallback };
      }
    }
    return;
  }
  private file(taskId: string): string { return path.join(this.workspaceRoot, '.lgs', 'tasks', taskId, 'escalations.json'); }
  private write(taskId: string, records: EscalationRecord[]): void { const file = this.file(taskId); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(records, null, 2) + '\n'); }
}

function resolveModel(model: ConfiguredAgentModel, fallbackProfileId: string): AgentModelIdentity { return { profileId: model.profileId ?? fallbackProfileId, model: model.model }; }
