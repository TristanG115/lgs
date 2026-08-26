import { textMessage } from '../model/types.js';
import { ToolFailure, type ToolPermission } from '../tools/types.js';
import { ToolRegistry, toolError } from '../tools/framework.js';
import type { Orchestrator } from './orchestrator.js';
import { AGENT_ROLES, type AgentAccess, type DelegatedSubtask } from './types.js';

const ORCHESTRATION_PERMISSION: ToolPermission = { access: 'execute', scope: 'workspace', network: true, category: 'process' };
const STATUS_PERMISSION: ToolPermission = { access: 'read-only', scope: 'workspace', network: false, category: 'read-only' };
const WORKER_ROLES = AGENT_ROLES.filter(role => role !== 'manager');

export function registerOrchestrationTools(registry: ToolRegistry, orchestrator: Orchestrator, managerAgentId: string): ToolRegistry {
  registry.register({
    id: 'delegate_subtasks', description: 'Delegate bounded independent work to specialized logical agents. Read-only tasks may run concurrently; write tasks are serialized. Returns compact reports, never worker transcripts.', permission: ORCHESTRATION_PERMISSION,
    argumentSchema: { type: 'object', properties: {
      tasks: { type: 'array', minItems: 1, maxItems: 16, items: { type: 'object', properties: {
        role: { type: 'string', enum: WORKER_ROLES }, objective: { type: 'string', minLength: 1, maxLength: 4000 },
        access: { type: 'string', enum: ['read-only', 'write'] }, context: { type: 'array', maxItems: 30, items: { type: 'string', minLength: 1, maxLength: 4000 } }
      }, required: ['role', 'objective'], additionalProperties: false } }
    }, required: ['tasks'], additionalProperties: false },
    execute: async (arguments_, context) => {
      const tasks = (arguments_.tasks as Record<string, unknown>[]).map(task => ({
        role: task.role as DelegatedSubtask['role'], objective: task.objective as string, access: task.access as AgentAccess | undefined,
        context: (task.context as string[] | undefined)?.map(value => textMessage('user', value))
      }));
      const results = await orchestrator.runSubtasks(managerAgentId, tasks, context.signal);
      return { data: { results }, resultCount: results.length, source: 'execution' };
    }
  });
  registry.register({
    id: 'list_agents', description: 'List logical agent sessions and lifecycle states without returning private contexts or transcripts.', permission: STATUS_PERMISSION,
    argumentSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: () => { const agents = orchestrator.listAgents(); return { data: { agents }, resultCount: agents.length, source: 'execution' }; }
  });
  registry.register({
    id: 'cancel_agent', description: 'Cancel a created or running logical agent.', permission: ORCHESTRATION_PERMISSION,
    argumentSchema: { type: 'object', properties: { agentId: { type: 'string', minLength: 1, maxLength: 128 } }, required: ['agentId'], additionalProperties: false },
    execute: arguments_ => {
      const cancelled = orchestrator.cancelAgent(arguments_.agentId as string);
      if (!cancelled) throw new ToolFailure(toolError('not_found', 'A cancellable agent was not found.'));
      return { data: { cancelled: true }, resultCount: 1, source: 'execution' };
    }
  });
  registry.register({
    id: 'destroy_agent', description: 'Destroy a completed, failed, cancelled, or unused logical agent session.', permission: ORCHESTRATION_PERMISSION,
    argumentSchema: { type: 'object', properties: { agentId: { type: 'string', minLength: 1, maxLength: 128 } }, required: ['agentId'], additionalProperties: false },
    execute: arguments_ => {
      const destroyed = orchestrator.destroyAgent(arguments_.agentId as string);
      if (!destroyed) throw new ToolFailure(toolError('invalid_request', 'The agent does not exist or is still running.'));
      return { data: { destroyed: true }, resultCount: 1, source: 'execution' };
    }
  });
  return registry;
}
