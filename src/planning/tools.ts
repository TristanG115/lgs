import { ToolFailure, type ToolPermission } from '../tools/types.js';
import { ToolRegistry, toolError } from '../tools/framework.js';
import type { FileTaskStateStore } from '../watchdog/state.js';
import { PlanningArtifactStore } from './artifact.js';
import type { PlanHandoff, PlanSection } from './types.js';

const PLAN_PERMISSION: ToolPermission = { access: 'execute', scope: 'workspace', network: false, category: 'process' };
const READ_PERMISSION: ToolPermission = { access: 'read-only', scope: 'workspace', network: false, category: 'read-only' };
const LIST = { type: 'array' as const, maxItems: 100, items: { type: 'string' as const, minLength: 1, maxLength: 1000 } };
const PLAN_PROPERTIES = { objective: { type: 'string' as const, minLength: 1, maxLength: 4000 }, acceptanceCriteria: LIST, currentUnderstanding: LIST, approach: LIST, expectedAreas: LIST, implementationStages: LIST, verificationPlan: LIST, risks: LIST, openQuestions: LIST };

export function registerPlanningTools(registry: ToolRegistry, tasks: FileTaskStateStore, plans = new PlanningArtifactStore(tasks.workspaceRoot, tasks)): ToolRegistry {
  registry.register({
    id: 'create_plan_task', description: 'Persist a structured Planning Mode artifact as PLAN.md and task state. Planning remains read-only except for its own task artifacts.', permission: PLAN_PERMISSION,
    argumentSchema: { type: 'object', properties: { taskId: { type: 'string', minLength: 1, maxLength: 128 }, ...PLAN_PROPERTIES, subtasks: LIST, handoff: { type: 'string', enum: ['wait-for-approval', 'implement-automatically'] } }, required: ['taskId', 'objective', 'acceptanceCriteria'], additionalProperties: false },
    validate: args => !args.implementationStages && !args.subtasks ? ['Provide implementationStages.'] : [],
    execute: args => ({ data: plans.create(args.taskId as string, planOf(args), args.handoff as PlanHandoff | undefined ?? 'wait-for-approval'), resultCount: 1, source: 'execution' })
  });
  registry.register({ id: 'get_plan', description: 'Read the current structured plan and its append-only revision history.', permission: READ_PERMISSION, argumentSchema: { type: 'object', properties: {}, additionalProperties: false }, execute: (_args, context) => { if (!context.taskId) throw new ToolFailure(toolError('invalid_request', 'A task ID is required.')); const plan = plans.read(context.taskId); if (!plan) throw new ToolFailure(toolError('not_found', 'PLAN.md was not found.')); return { data: plan, resultCount: 1, source: 'filesystem' }; } });
  registry.register({ id: 'revise_plan', description: 'Append an explicit plan revision with rationale and evidence. Historical rationale is never rewritten.', permission: PLAN_PERMISSION, argumentSchema: { type: 'object', properties: { changed: { type: 'string', minLength: 1, maxLength: 2000 }, reason: { type: 'string', minLength: 1, maxLength: 2000 }, evidence: LIST }, required: ['changed', 'reason', 'evidence'], additionalProperties: false }, execute: (args, context) => { if (!context.taskId) throw new ToolFailure(toolError('invalid_request', 'A task ID is required.')); return { data: plans.revise(context.taskId, args.changed as string, args.reason as string, args.evidence as string[]), resultCount: 1, source: 'execution' }; } });
  return registry;
}

function planOf(value: Record<string, unknown>): PlanSection {
  return { objective: value.objective as string, acceptanceCriteria: value.acceptanceCriteria as string[], currentUnderstanding: value.currentUnderstanding as string[] | undefined ?? [], approach: value.approach as string[] | undefined ?? [], expectedAreas: value.expectedAreas as string[] | undefined ?? [], implementationStages: value.implementationStages as string[] | undefined ?? value.subtasks as string[] | undefined ?? [], verificationPlan: value.verificationPlan as string[] | undefined ?? [], risks: value.risks as string[] | undefined ?? [], openQuestions: value.openQuestions as string[] | undefined ?? [] };
}
