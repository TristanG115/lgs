import type { ConfiguredAgentModel } from '../orchestration/types.js';
import { ROUTING_ROLES, type CostTier, type ModelRoute, type PrivacyPolicy, type RoutingConfiguration, type RoutingRole } from './types.js';

const DEFAULT: RoutingConfiguration = { roles: {}, models: [], policy: { privacy: 'cloud_allowed', preferLocal: true, preferCheapest: false } };

export function parseRoutingConfiguration(value: Record<string, unknown> = {}, errors: string[] = []): RoutingConfiguration {
  const result: RoutingConfiguration = { roles: {}, models: [], policy: { ...DEFAULT.policy } };
  for (const key of Object.keys(value)) if (!['roles', 'models', 'policy'].includes(key)) errors.push(`Unknown routing setting: ${key}.`);
  if (value.roles !== undefined) {
    if (!record(value.roles)) errors.push('routing.roles must be a YAML object.');
    else for (const [role, model] of Object.entries(value.roles)) {
      if (!ROUTING_ROLES.includes(role as RoutingRole)) { errors.push(`Unknown routing role: ${role}.`); continue; }
      const parsed = parseRoute(model, `routing.roles.${role}`, errors);
      if (parsed) result.roles[role as RoutingRole] = parsed;
    }
  }
  if (value.models !== undefined) {
    if (!Array.isArray(value.models)) errors.push('routing.models must be an array.');
    else result.models = value.models.flatMap((model, index) => { const parsed = parseRoute(model, `routing.models[${index}]`, errors); return parsed ? [parsed] : []; });
  }
  if (value.policy !== undefined) parsePolicy(value.policy, result, errors);
  return result;
}

function parsePolicy(value: unknown, result: RoutingConfiguration, errors: string[]): void {
  if (!record(value)) { errors.push('routing.policy must be a YAML object.'); return; }
  for (const key of Object.keys(value)) if (!['privacy', 'preferLocal', 'preferCheapest', 'maxCostTier'].includes(key)) errors.push(`Unknown routing.policy setting: ${key}.`);
  if (value.privacy !== undefined) {
    if (privacy(value.privacy)) result.policy.privacy = value.privacy;
    else errors.push('routing.policy.privacy must be local_only, cloud_allowed, or ask_before_cloud.');
  }
  for (const key of ['preferLocal', 'preferCheapest'] as const) if (value[key] !== undefined) {
    if (typeof value[key] === 'boolean') result.policy[key] = value[key] as boolean;
    else errors.push(`routing.policy.${key} must be a boolean.`);
  }
  if (value.maxCostTier !== undefined) {
    if (cost(value.maxCostTier)) result.policy.maxCostTier = value.maxCostTier;
    else errors.push('routing.policy.maxCostTier must be low, medium, or high.');
  }
}

function parseRoute(value: unknown, location: string, errors: string[]): ModelRoute | undefined {
  const base = parseModel(value, location, errors); if (!base) return;
  if (typeof value === 'string') return base;
  const raw = value as Record<string, unknown>;
  const allowed = new Set(['profileId', 'model', 'contextWindow', 'toolSupport', 'vision', 'costTier', 'benchmarkScore', 'failures']);
  const unknown = Object.keys(raw).filter(key => !allowed.has(key));
  if (unknown.length) { errors.push(`${location} contains unknown fields: ${unknown.join(', ')}.`); return; }
  for (const key of ['contextWindow', 'benchmarkScore', 'failures'] as const) if (raw[key] !== undefined && (!Number.isFinite(raw[key]) || Number(raw[key]) < 0)) { errors.push(`${location}.${key} must be a non-negative number.`); return; }
  for (const key of ['toolSupport', 'vision'] as const) if (raw[key] !== undefined && typeof raw[key] !== 'boolean') { errors.push(`${location}.${key} must be a boolean.`); return; }
  if (raw.costTier !== undefined && !cost(raw.costTier)) { errors.push(`${location}.costTier must be low, medium, or high.`); return; }
  return { ...base, contextWindow: raw.contextWindow as number | undefined, toolSupport: raw.toolSupport as boolean | undefined, vision: raw.vision as boolean | undefined, costTier: raw.costTier as CostTier | undefined, benchmarkScore: raw.benchmarkScore as number | undefined, failures: raw.failures as number | undefined };
}
function parseModel(value: unknown, location: string, errors: string[]): ConfiguredAgentModel | undefined {
  if (typeof value === 'string' && value.trim()) return { model: value.trim() };
  if (!record(value) || typeof value.model !== 'string' || !value.model.trim() || value.profileId !== undefined && (typeof value.profileId !== 'string' || !value.profileId.trim())) { errors.push(`${location} must contain model and optional profileId.`); return; }
  return { model: value.model.trim(), profileId: value.profileId as string | undefined };
}
function privacy(value: unknown): value is PrivacyPolicy { return value === 'local_only' || value === 'cloud_allowed' || value === 'ask_before_cloud'; }
function cost(value: unknown): value is CostTier { return value === 'low' || value === 'medium' || value === 'high'; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
