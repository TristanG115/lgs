import type { UsageConfiguration, UsageBudgets } from './types.js';

const DEFAULT_BUDGETS: UsageBudgets = { periodDays: 30, warnAtPercent: 80, askBeforeCloudEscalation: true };
export const DEFAULT_USAGE_CONFIGURATION: UsageConfiguration = { retentionDays: 90, maxRecords: 10_000, budgets: DEFAULT_BUDGETS };

export function parseUsageConfiguration(value: unknown = {}, errors: string[] = []): UsageConfiguration {
  const result: UsageConfiguration = { retentionDays: DEFAULT_USAGE_CONFIGURATION.retentionDays, maxRecords: DEFAULT_USAGE_CONFIGURATION.maxRecords, budgets: { ...DEFAULT_BUDGETS } };
  if (!record(value)) { errors.push('usage must be a YAML object.'); return result; }
  for (const key of Object.keys(value)) if (!['retentionDays', 'maxRecords', 'budgets'].includes(key)) errors.push(`Unknown usage setting: ${key}.`);
  if (value.retentionDays !== undefined) number(value.retentionDays, 'usage.retentionDays', 1, 3650, errors, value_ => result.retentionDays = value_);
  if (value.maxRecords !== undefined) number(value.maxRecords, 'usage.maxRecords', 1, 1_000_000, errors, value_ => result.maxRecords = value_);
  if (value.budgets === undefined) return result;
  if (!record(value.budgets)) { errors.push('usage.budgets must be a YAML object.'); return result; }
  const budgets = value.budgets;
  for (const key of Object.keys(budgets)) if (!['maxCloudSpendPerTask', 'maxCloudSpendPerPeriod', 'periodDays', 'warnAtPercent', 'askBeforeCloudEscalation', 'contextUtilizationTarget'].includes(key)) errors.push(`Unknown usage.budgets setting: ${key}.`);
  for (const key of ['maxCloudSpendPerTask', 'maxCloudSpendPerPeriod'] as const) if (budgets[key] !== undefined) decimal(budgets[key], `usage.budgets.${key}`, 0, Number.MAX_SAFE_INTEGER, errors, value_ => result.budgets[key] = value_);
  numberIfPresent(budgets.periodDays, 'usage.budgets.periodDays', 1, 3650, errors, value_ => result.budgets.periodDays = value_);
  numberIfPresent(budgets.warnAtPercent, 'usage.budgets.warnAtPercent', 1, 100, errors, value_ => result.budgets.warnAtPercent = value_);
  numberIfPresent(budgets.contextUtilizationTarget, 'usage.budgets.contextUtilizationTarget', 1, 100, errors, value_ => result.budgets.contextUtilizationTarget = value_);
  if (budgets.askBeforeCloudEscalation !== undefined) {
    if (typeof budgets.askBeforeCloudEscalation === 'boolean') result.budgets.askBeforeCloudEscalation = budgets.askBeforeCloudEscalation;
    else errors.push('usage.budgets.askBeforeCloudEscalation must be a boolean.');
  }
  return result;
}

function number(value: unknown, label: string, min: number, max: number, errors: string[], set: (value: number) => void): void { if (!Number.isFinite(value) || !Number.isInteger(value) || Number(value) < min || Number(value) > max) errors.push(`${label} must be a whole number from ${min} to ${max}.`); else set(Number(value)); }
function decimal(value: unknown, label: string, min: number, max: number, errors: string[], set: (value: number) => void): void { if (!Number.isFinite(value) || Number(value) < min || Number(value) > max) errors.push(`${label} must be a number from ${min} to ${max}.`); else set(Number(value)); }
function numberIfPresent(value: unknown, label: string, min: number, max: number, errors: string[], set: (value: number) => void): void { if (value !== undefined) number(value, label, min, max, errors, set); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
