import type { ToolRegistry } from '../tools/framework.js';
import type { UsageTracker } from './service.js';
import type { FilePricingStore } from './store.js';
import type { PricingEntry } from './types.js';

const READ = { access: 'read-only' as const, scope: 'workspace' as const, network: false };
const WRITE = { access: 'execute' as const, scope: 'workspace' as const, network: false };
export function registerUsageTools(registry: ToolRegistry, usage: UsageTracker, pricing: FilePricingStore): ToolRegistry {
  registry.register({ id: 'get_usage_dashboard', description: 'Read local token, context, performance, cost, savings, and cloud-escalation aggregates. Prompt contents are never returned.', permission: READ, argumentSchema: { type: 'object', properties: { taskId: { type: 'string', minLength: 1, maxLength: 128 } }, additionalProperties: false }, execute: args => { const dashboard = usage.dashboard(args.taskId as string | undefined); return { data: dashboard, resultCount: dashboard.records.length, source: 'filesystem' }; } });
  registry.register({ id: 'get_usage_records', description: 'Read local normalized request metrics without prompts, source contents, or completions.', permission: READ, argumentSchema: { type: 'object', properties: { taskId: { type: 'string', minLength: 1, maxLength: 128 }, limit: { type: 'integer', minimum: 1, maximum: 1000 } }, additionalProperties: false }, execute: args => { const records = usage.records().filter(record => !args.taskId || record.task === args.taskId).slice(-(args.limit as number | undefined ?? 100)); return { data: { records }, resultCount: records.length, source: 'filesystem' }; } });
  registry.register({ id: 'cleanup_usage_records', description: 'Apply configured local usage retention and cleanup controls.', permission: WRITE, argumentSchema: { type: 'object', properties: {}, additionalProperties: false }, execute: () => { const removed = usage.cleanup(); return { data: { removed }, resultCount: removed, source: 'filesystem' }; } });
  registry.register({ id: 'configure_usage_pricing', description: 'Update local pricing metadata separately from tracked usage. Institutional billing remains explicit rather than being shown as zero-dollar API pricing.', permission: WRITE, argumentSchema: { type: 'object', properties: { entries: { type: 'object', properties: {}, additionalProperties: true } }, required: ['entries'], additionalProperties: false }, execute: args => { pricing.update(args.entries as Record<string, PricingEntry>); return { data: { updated: Object.keys(args.entries as object).length }, resultCount: Object.keys(args.entries as object).length, source: 'filesystem' }; } });
  return registry;
}
