import { ToolRegistry } from '../tools/framework.js';
import type { ToolPermission } from '../tools/types.js';
import type { IntegrationHub } from './hub.js';

const READ: ToolPermission = { access: 'read-only', scope: 'workspace', network: false, category: 'read-only' };
export function registerIntegrationTools(registry: ToolRegistry, hub: IntegrationHub): ToolRegistry {
  registry.register({ id: 'list_integrations', description: 'List installed MCP servers, plugins, and connected apps with health, capabilities, permissions, and allowed agents.', permission: READ, argumentSchema: { type: 'object', properties: {}, additionalProperties: false }, execute: () => { const integrations = hub.list(); return { data: { integrations }, resultCount: integrations.length, source: 'filesystem' }; } });
  for (const external of hub.toolsFor()) registry.register({ id: external.definition.id, description: external.definition.description, permission: external.definition.permission, argumentSchema: external.definition.schema as Extract<import('../tools/types.js').JsonSchema, { type: 'object' }>, execute: (args, context) => hub.execute(external.definition.id, args, context) });
  return registry;
}
