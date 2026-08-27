import type { AgentModelIdentity } from '../orchestration/types.js';
import type { ModelRoute, RoutingBudgetGate, RoutingConfiguration, RoutingDecision, RoutingRequest, ProviderPolicyLookup } from './types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

const COST = { low: 0, medium: 1, high: 2 } as const;

export class ModelRouter {
  constructor(private readonly configuration: RoutingConfiguration, private readonly providerPolicy: ProviderPolicyLookup = () => undefined, private readonly budgetGate?: RoutingBudgetGate) {}

  route(request: RoutingRequest): RoutingDecision {
    const pin = request.taskModel ?? request.roleModel ?? request.provider ? { model: request.roleModel?.model ?? request.taskModel?.model ?? request.fallback.model, profileId: request.provider ?? request.roleModel?.profileId ?? request.taskModel?.profileId ?? request.fallback.profileId } : undefined;
    const configured = pin ?? this.configuration.roles[request.role] ?? this.bestCandidate(request) ?? request.fallback;
    const identity: AgentModelIdentity = { profileId: configured.profileId ?? request.fallback.profileId, model: configured.model };
    const automatic = !pin;
    const reason = pin ? 'Manual pin selected.' : configured === request.fallback ? 'No eligible configured route; retained active model.' : this.reason(configured, request, identity);
    if (!this.permitted(identity.profileId)) return { role: request.role, identity: request.fallback, automatic, policy: this.configuration.policy.privacy, recordedAt: new Date().toISOString(), blocked: true, reason: `Blocked ${identity.profileId}:${identity.model}; ${this.configuration.policy.privacy} forbids repository source to that provider.` };
    const budget = this.providerPolicy(identity.profileId) === 'local' ? undefined : this.budgetGate?.(request, identity);
    if (budget && !budget.allowed) return { role: request.role, identity: request.fallback, automatic, policy: this.configuration.policy.privacy, recordedAt: new Date().toISOString(), blocked: true, requiresApproval: /confirmation/i.test(budget.warning ?? ''), reason: `Blocked ${identity.profileId}:${identity.model}; ${budget.warning ?? 'cloud budget policy disallows this route.'}` };
    return { role: request.role, identity, automatic, policy: this.configuration.policy.privacy, recordedAt: new Date().toISOString(), reason };
  }

  private bestCandidate(request: RoutingRequest): ModelRoute | undefined {
    return this.configuration.models.filter(candidate => this.eligible(candidate, request)).sort((a, b) => this.score(b, request) - this.score(a, request))[0];
  }
  private eligible(candidate: ModelRoute, request: RoutingRequest): boolean {
    if (!candidate.profileId || !this.permitted(candidate.profileId)) return false;
    if (request.contextTokens && candidate.contextWindow !== undefined && candidate.contextWindow < request.contextTokens) return false;
    if (request.needsTools && candidate.toolSupport === false) return false;
    if (request.needsVision && candidate.vision !== true) return false;
    return !(this.configuration.policy.maxCostTier && candidate.costTier && COST[candidate.costTier] > COST[this.configuration.policy.maxCostTier]);
  }
  private score(candidate: ModelRoute, request: RoutingRequest): number {
    let score = (candidate.benchmarkScore ?? 0) * 100 - (candidate.failures ?? 0) * 30;
    if (this.configuration.policy.preferCheapest) score -= COST[candidate.costTier ?? 'medium'] * 1_000;
    if (this.configuration.policy.preferLocal && this.providerPolicy(candidate.profileId!) === 'local') score += 25;
    if (request.difficulty === 'high') score += (candidate.benchmarkScore ?? 0) * 100;
    return score;
  }
  private permitted(profileId: string): boolean {
    const policy = this.providerPolicy(profileId);
    if (policy === 'metadata_only') return false;
    if (this.configuration.policy.privacy === 'cloud_allowed') return true;
    return policy === 'local';
  }
  private reason(route: ModelRoute, request: RoutingRequest, identity: AgentModelIdentity): string {
    const clauses = [`Selected ${identity.profileId}:${identity.model}`, `${request.role} role`];
    if (this.configuration.policy.preferCheapest && route.costTier) clauses.push(`${route.costTier}-cost capable model`);
    if (this.providerPolicy(identity.profileId) === 'local') clauses.push('local privacy preference');
    if (request.needsVision) clauses.push('vision support');
    if (request.needsTools) clauses.push('tool support');
    return clauses.join('; ') + '.';
  }
}

export class FileRoutingDecisionStore {
  constructor(private readonly workspaceRoot: string) {}
  record(taskId: string, decision: RoutingDecision): void {
    if (!/^[a-zA-Z0-9._-]{1,128}$/.test(taskId)) return;
    const file = path.join(this.workspaceRoot, '.lgs', 'tasks', taskId, 'routing.json');
    let decisions: RoutingDecision[] = [];
    try { const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(parsed)) decisions = parsed as RoutingDecision[]; } catch { /* New task. */ }
    decisions.push(decision); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(decisions, null, 2) + '\n');
  }
  read(taskId: string): RoutingDecision[] {
    try { const parsed: unknown = JSON.parse(fs.readFileSync(path.join(this.workspaceRoot, '.lgs', 'tasks', taskId, 'routing.json'), 'utf8')); return Array.isArray(parsed) ? parsed as RoutingDecision[] : []; } catch { return []; }
  }
}
