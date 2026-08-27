import type { ResearchConfiguration } from './types.js';

export function parseResearchConfiguration(value: Record<string, unknown> = {}, errors: string[] = []): ResearchConfiguration {
  const result: ResearchConfiguration = { freshnessDays: 14, maxResults: 6, maxFetchBytes: 512_000, endpoints: {}, github: { enabled: true, apiBaseUrl: 'https://api.github.com' }, autoResearch: 'when-uncertain', webEnabled: true, budgets: { maximumCycles: 24, maximumConsecutiveFailedCycles: 5, wallClockMinutes: 240, minimumProgressCycles: 3 } };
  const allowed = new Set(['freshnessDays', 'maxResults', 'maxFetchBytes', 'endpoints', 'github', 'autoResearch', 'webEnabled', 'budgets']);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`Unknown research setting: ${key}.`);
  integer(value, 'freshnessDays', 1, 365, result, errors);
  integer(value, 'maxResults', 1, 20, result, errors);
  integer(value, 'maxFetchBytes', 16_384, 2_000_000, result, errors);
  if (value.autoResearch !== undefined && !['off', 'when-uncertain', 'proactive'].includes(String(value.autoResearch))) errors.push('research.autoResearch must be off, when-uncertain, or proactive.');
  else if (value.autoResearch !== undefined) result.autoResearch = value.autoResearch as ResearchConfiguration['autoResearch'];
  if (value.webEnabled !== undefined && typeof value.webEnabled !== 'boolean') errors.push('research.webEnabled must be a boolean.');
  else if (typeof value.webEnabled === 'boolean') result.webEnabled = value.webEnabled;
  if (value.budgets !== undefined) {
    if (!record(value.budgets)) errors.push('research.budgets must be a YAML object.');
    else {
      const allowedBudgets = new Set(['maximumCycles', 'maximumConsecutiveFailedCycles', 'wallClockMinutes', 'maximumTokens', 'maximumCostUsd', 'minimumProgressCycles']);
      for (const key of Object.keys(value.budgets)) if (!allowedBudgets.has(key)) errors.push(`Unknown research.budgets setting: ${key}.`);
      budgetInteger(value.budgets, 'maximumCycles', 1, 1000, result, errors);
      budgetInteger(value.budgets, 'maximumConsecutiveFailedCycles', 1, 100, result, errors);
      budgetInteger(value.budgets, 'wallClockMinutes', 1, 525600, result, errors);
      budgetInteger(value.budgets, 'maximumTokens', 1, 1_000_000_000, result, errors);
      budgetInteger(value.budgets, 'minimumProgressCycles', 1, 100, result, errors);
      if (value.budgets.maximumCostUsd !== undefined && (typeof value.budgets.maximumCostUsd !== 'number' || !Number.isFinite(value.budgets.maximumCostUsd) || value.budgets.maximumCostUsd <= 0)) errors.push('research.budgets.maximumCostUsd must be a positive number.');
      else if (typeof value.budgets.maximumCostUsd === 'number') result.budgets.maximumCostUsd = value.budgets.maximumCostUsd;
    }
  }
  if (value.endpoints !== undefined) {
    if (!record(value.endpoints)) errors.push('research.endpoints must be a YAML object.');
    else for (const [kind, endpoint] of Object.entries(value.endpoints)) {
      if (!['webSearch', 'documentationSearch', 'repositorySearch'].includes(kind) || typeof endpoint !== 'string' || !validEndpoint(endpoint)) errors.push(`Invalid research endpoint: ${kind}.`);
      else result.endpoints[kind as keyof ResearchConfiguration['endpoints']] = endpoint;
    }
  }
  if (value.github !== undefined) {
    if (!record(value.github)) errors.push('research.github must be a YAML object.');
    else {
      for (const key of Object.keys(value.github)) if (!['enabled', 'apiBaseUrl'].includes(key)) errors.push(`Unknown research.github setting: ${key}.`);
      if (value.github.enabled !== undefined && typeof value.github.enabled !== 'boolean') errors.push('research.github.enabled must be a boolean.');
      else if (typeof value.github.enabled === 'boolean') result.github.enabled = value.github.enabled;
      if (value.github.apiBaseUrl !== undefined && (typeof value.github.apiBaseUrl !== 'string' || !validEndpoint(value.github.apiBaseUrl))) errors.push('research.github.apiBaseUrl must be an HTTP(S) URL.');
      else if (typeof value.github.apiBaseUrl === 'string') result.github.apiBaseUrl = value.github.apiBaseUrl.replace(/\/$/, '');
    }
  }
  return result;
}

function budgetInteger(value: Record<string, unknown>, key: 'maximumCycles' | 'maximumConsecutiveFailedCycles' | 'wallClockMinutes' | 'maximumTokens' | 'minimumProgressCycles', minimum: number, maximum: number, result: ResearchConfiguration, errors: string[]): void {
  const candidate = value[key]; if (candidate === undefined) return;
  if (!Number.isInteger(candidate) || Number(candidate) < minimum || Number(candidate) > maximum) errors.push(`research.budgets.${key} must be an integer from ${minimum} to ${maximum}.`);
  else if (key === 'maximumTokens') result.budgets.maximumTokens = candidate as number;
  else result.budgets[key] = candidate as number;
}

function integer(value: Record<string, unknown>, key: 'freshnessDays' | 'maxResults' | 'maxFetchBytes', minimum: number, maximum: number, result: ResearchConfiguration, errors: string[]): void {
  const candidate = value[key]; if (candidate === undefined) return;
  if (!Number.isInteger(candidate) || Number(candidate) < minimum || Number(candidate) > maximum) errors.push(`research.${key} must be an integer from ${minimum} to ${maximum}.`);
  else result[key] = candidate as number;
}
function validEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password;
  } catch { return false; }
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
