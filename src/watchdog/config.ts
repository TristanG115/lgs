import { ESCALATION_LEVELS, type EscalationLevel, type WatchdogConfiguration } from './types.js';
import type { ConfiguredAgentModel } from '../orchestration/types.js';

export function parseWatchdogConfiguration(value: Record<string, unknown> = {}, errors: string[] = []): WatchdogConfiguration {
  const result: WatchdogConfiguration = { intervalTurns: 3, escalationRoutes: {} };
  const allowed = new Set(['intervalTurns', 'model', 'escalation']);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`Unknown watchdog setting: ${key}.`);
  if (value.intervalTurns !== undefined) {
    if (!Number.isInteger(value.intervalTurns) || Number(value.intervalTurns) < 1 || Number(value.intervalTurns) > 16) errors.push('watchdog.intervalTurns must be an integer from 1 to 16.');
    else result.intervalTurns = value.intervalTurns as number;
  }
  if (value.model !== undefined) result.model = parseModel(value.model, 'watchdog.model', errors);
  if (value.escalation !== undefined) {
    if (!record(value.escalation)) errors.push('watchdog.escalation must be a YAML object.');
    else {
      const unknown = Object.keys(value.escalation).filter(key => key !== 'routes');
      if (unknown.length) errors.push(`watchdog.escalation contains unknown fields: ${unknown.join(', ')}.`);
      if (value.escalation.routes !== undefined) {
        if (!record(value.escalation.routes)) errors.push('watchdog.escalation.routes must be a YAML object.');
        else for (const [level, raw] of Object.entries(value.escalation.routes)) {
          if (!ESCALATION_LEVELS.includes(level as EscalationLevel)) { errors.push(`Unknown escalation level: ${level}.`); continue; }
          const model = parseModel(raw, `watchdog.escalation.routes.${level}`, errors);
          if (model) result.escalationRoutes[level as EscalationLevel] = model;
        }
      }
    }
  }
  return result;
}

function parseModel(value: unknown, location: string, errors: string[]): ConfiguredAgentModel | undefined {
  if (typeof value === 'string' && value.trim()) return { model: value.trim() };
  if (!record(value) || typeof value.model !== 'string' || !value.model.trim() || value.profileId !== undefined && (typeof value.profileId !== 'string' || !value.profileId.trim()) || Object.keys(value).some(key => key !== 'profileId' && key !== 'model')) {
    errors.push(`${location} must be a model string or an object with model and optional profileId.`); return;
  }
  return { model: value.model.trim(), profileId: typeof value.profileId === 'string' ? value.profileId.trim() : undefined };
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
