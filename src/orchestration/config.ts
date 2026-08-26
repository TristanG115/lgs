import { AGENT_ROLES, type AgentRole, type ConfiguredAgentModel, type OrchestrationConfiguration } from './types.js';

const DEFAULT_CONFIGURATION: OrchestrationConfiguration = {
  roleModels: {}, readOnlyConcurrency: 2, maxWorkersPerBatch: 6, maxContextMessages: 30
};

export function parseOrchestrationConfiguration(value: Record<string, unknown> = {}, errors: string[] = []): OrchestrationConfiguration {
  const configuration: OrchestrationConfiguration = { ...DEFAULT_CONFIGURATION, roleModels: {} };
  const allowed = new Set(['roleModels', 'readOnlyConcurrency', 'maxWorkersPerBatch', 'maxContextMessages']);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`Unknown agents setting: ${key}.`);
  if (value.roleModels !== undefined) {
    if (!record(value.roleModels)) errors.push('agents.roleModels must be a YAML object.');
    else for (const [role, rawModel] of Object.entries(value.roleModels)) {
      if (!AGENT_ROLES.includes(role as AgentRole)) { errors.push(`Unknown agent role: ${role}.`); continue; }
      const model = parseModel(rawModel, `agents.roleModels.${role}`, errors);
      if (model) configuration.roleModels[role as AgentRole] = model;
    }
  }
  integerSetting(value, 'readOnlyConcurrency', 1, 16, configuration, errors);
  integerSetting(value, 'maxWorkersPerBatch', 1, 16, configuration, errors);
  integerSetting(value, 'maxContextMessages', 1, 100, configuration, errors);
  return configuration;
}

function parseModel(value: unknown, location: string, errors: string[]): ConfiguredAgentModel | undefined {
  if (typeof value === 'string' && value.trim()) return { model: value.trim() };
  if (!record(value)) { errors.push(`${location} must be a model string or object.`); return; }
  const unknown = Object.keys(value).filter(key => key !== 'profileId' && key !== 'model');
  if (unknown.length || typeof value.model !== 'string' || !value.model.trim() || value.profileId !== undefined && (typeof value.profileId !== 'string' || !value.profileId.trim())) {
    errors.push(`${location} must contain model and an optional profileId.`); return;
  }
  return { model: value.model.trim(), profileId: typeof value.profileId === 'string' ? value.profileId.trim() : undefined };
}

function integerSetting(value: Record<string, unknown>, key: 'readOnlyConcurrency' | 'maxWorkersPerBatch' | 'maxContextMessages', minimum: number, maximum: number, result: OrchestrationConfiguration, errors: string[]): void {
  const candidate = value[key];
  if (candidate === undefined) return;
  if (!Number.isInteger(candidate) || Number(candidate) < minimum || Number(candidate) > maximum) errors.push(`agents.${key} must be an integer from ${minimum} to ${maximum}.`);
  else result[key] = candidate as number;
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
