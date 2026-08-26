import { ToolFailure, type ToolPermission } from '../tools/types.js';
import { ToolRegistry, toolError } from '../tools/framework.js';
import type { FileTaskStateStore } from '../watchdog/state.js';

const PLAN_PERMISSION: ToolPermission = { access: 'execute', scope: 'workspace', network: false, category: 'process' };
const LIST = { type: 'array' as const, minItems: 1, maxItems: 100, items: { type: 'string' as const, minLength: 1, maxLength: 1000 } };

export function registerPlanningTools(registry: ToolRegistry, tasks: FileTaskStateStore): ToolRegistry {
  registry.register({ id: 'create_plan_task', description: 'Turn an approved plan into persistent LGS task state with an objective, acceptance criteria, and subtasks. This is allowed from Planning Mode.', permission: PLAN_PERMISSION, argumentSchema: { type: 'object', properties: { taskId: { type: 'string', minLength: 1, maxLength: 128 }, objective: { type: 'string', minLength: 1, maxLength: 4000 }, acceptanceCriteria: LIST, subtasks: LIST }, required: ['taskId', 'objective', 'acceptanceCriteria', 'subtasks'], additionalProperties: false }, execute: args => { const taskId = args.taskId as string; if (tasks.read(taskId)) throw new ToolFailure(toolError('invalid_request', 'A task with this ID already exists.')); const task = tasks.ensure(taskId, args.objective as string); return { data: tasks.update(taskId, { acceptanceCriteria: args.acceptanceCriteria as string[], currentPlan: args.subtasks as string[], remainingWork: args.subtasks as string[], completedWork: task.completedWork }), resultCount: 1, source: 'execution' }; } }); return registry;
}
