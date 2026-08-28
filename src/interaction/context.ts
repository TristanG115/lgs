import type { ContextUsage } from './types.js';

export function contextUsage(used?: number, maximum?: number, categories?: ContextUsage['categories']): ContextUsage {
  if (!positive(maximum)) return { unit: 'tokens', estimated: false, reason: 'Context capacity is not reported for the selected model.' };
  if (!nonNegative(used)) return { maximum, unit: 'tokens', estimated: false, reason: 'Current context usage is not available yet.' };
  const known = categories && Object.values(categories).every(nonNegative) ? categories : undefined;
  return { used, maximum, unit: 'tokens', estimated: false, ...(known ? { categories: known } : {}) };
}
export function contextPercent(value: ContextUsage): number | undefined { return positive(value.maximum) && nonNegative(value.used) ? Math.min(100, Math.round(value.used / value.maximum * 100)) : undefined; }
function positive(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value > 0; }
function nonNegative(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
