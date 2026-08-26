import type { AgentRole } from '../orchestration/types.js';
import { ToolFailure, type ToolExecutionOutput, type ToolExecutionContext } from '../tools/types.js';
import type { ExternalTool, IntegrationDescriptor } from './types.js';

export class IntegrationHub {
  private readonly integrations = new Map<string, IntegrationDescriptor>();
  private readonly tools = new Map<string, { definition: ExternalTool; execute: (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<ToolExecutionOutput<unknown>> | ToolExecutionOutput<unknown> }>();
  register(integration: IntegrationDescriptor): void { validateIntegration(integration); this.integrations.set(integration.id, { ...integration, capabilities: [...integration.capabilities], requestedPermissions: [...integration.requestedPermissions], allowedAgents: { ...integration.allowedAgents } }); }
  list(): IntegrationDescriptor[] { return [...this.integrations.values()].sort((a, b) => a.name.localeCompare(b.name)); }
  registerTool(tool: ExternalTool, execute: (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<ToolExecutionOutput<unknown>> | ToolExecutionOutput<unknown>): void { if (!this.integrations.has(tool.integrationId)) throw new Error('Integration must be registered before its tools.'); if (!/^[a-z][a-z0-9_]{0,63}$/.test(tool.id)) throw new Error('External tool ID is invalid.'); this.tools.set(tool.id, { definition: tool, execute }); }
  toolsFor(role?: AgentRole): { definition: ExternalTool; execute: (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<ToolExecutionOutput<unknown>> | ToolExecutionOutput<unknown> }[] { return [...this.tools.values()].filter(tool => this.allowed(tool.definition.integrationId, role)); }
  allowed(id: string, role?: AgentRole): boolean { const integration = this.integrations.get(id); return Boolean(integration && integration.status === 'healthy' && (!role || integration.allowedAgents[role] !== 'none')); }
  execute(toolId: string, args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionOutput<unknown>> | ToolExecutionOutput<unknown> { const tool = this.tools.get(toolId); if (!tool) throw new ToolFailure({ code: 'not_found', message: 'External capability was not found.', retryable: false }); if (!this.allowed(tool.definition.integrationId, context.agentRole)) throw new ToolFailure({ code: 'unsupported', message: 'This integration is not permitted for the current agent.', retryable: false }); return tool.execute(args, context); }
}
function validateIntegration(value: IntegrationDescriptor): void { if (!/^[a-z][a-z0-9._-]{0,80}$/.test(value.id) || !value.name.trim() || !value.description.trim()) throw new Error('Integration metadata is invalid.'); }
