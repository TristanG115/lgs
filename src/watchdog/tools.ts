import { ToolFailure, type ToolPermission } from '../tools/types.js';
import { ToolRegistry, toolError } from '../tools/framework.js';
import { FileTaskStateStore } from './state.js';
import type { WatchdogService } from './service.js';

const STATE_PERMISSION: ToolPermission = { access: 'execute', scope: 'workspace', network: false, category: 'process' };
const READ_PERMISSION: ToolPermission = { access: 'read-only', scope: 'workspace', network: false, category: 'read-only' };
const LIST = { type: 'array' as const, maxItems: 100, items: { type: 'string' as const, minLength: 1, maxLength: 1000 } };

export function registerWatchdogTools(registry: ToolRegistry, state: FileTaskStateStore, watchdog: WatchdogService): ToolRegistry {
  registry.register({
    id: 'update_task_state', description: 'Update compact LGS-owned task state for Watchdog review and escalation continuity. Omitted fields remain unchanged.', permission: STATE_PERMISSION,
    argumentSchema: { type: 'object', properties: {
      acceptanceCriteria: LIST, currentPlan: LIST, completedWork: LIST, remainingWork: LIST, recentModifications: LIST,
      explicitUncertainty: { type: 'string', maxLength: 2000 }
    }, additionalProperties: false },
    execute: (arguments_, context) => {
      if (!context.taskId) throw new ToolFailure(toolError('invalid_request', 'Task state requires a task ID.'));
      const updated = state.update(context.taskId, arguments_ as Parameters<FileTaskStateStore['update']>[1]);
      return { data: updated, resultCount: 1, source: 'execution' };
    }
  });
  registry.register({
    id: 'get_task_state', description: 'Read the compact persistent task state and latest Watchdog evaluation.', permission: READ_PERMISSION,
    argumentSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: (_arguments, context) => {
      if (!context.taskId) throw new ToolFailure(toolError('invalid_request', 'Task state requires a task ID.'));
      const task = state.read(context.taskId);
      if (!task) throw new ToolFailure(toolError('not_found', 'Task state was not found.'));
      const latestWatchdog = watchdog.read(context.taskId).at(-1);
      return { data: { task, latestWatchdog }, resultCount: 1, source: 'execution' };
    }
  });
  return registry;
}
