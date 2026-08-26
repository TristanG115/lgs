import type { ResearchConfiguration } from './types.js';

export function parseResearchConfiguration(value: Record<string, unknown> = {}, errors: string[] = []): ResearchConfiguration {
  const result: ResearchConfiguration = { freshnessDays: 14, maxResults: 6, maxFetchBytes: 512_000, endpoints: {}, github: { enabled: true, apiBaseUrl: 'https://api.github.com' } };
  const allowed = new Set(['freshnessDays', 'maxResults', 'maxFetchBytes', 'endpoints', 'github']);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`Unknown research setting: ${key}.`);
  integer(value, 'freshnessDays', 1, 365, result, errors);
  integer(value, 'maxResults', 1, 20, result, errors);
  integer(value, 'maxFetchBytes', 16_384, 2_000_000, result, errors);
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
