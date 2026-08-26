import type { AgentRole } from '../orchestration/types.js';
import type { JsonSchema, ToolPermission } from '../tools/types.js';

export type IntegrationOrigin = 'mcp' | 'plugin' | 'app';
export type IntegrationStatus = 'disconnected' | 'healthy' | 'error' | 'disabled';
export type IntegrationCapability = 'tool' | 'resource' | 'context-provider' | 'verification-provider' | 'skill' | 'command' | 'ui';
export type IntegrationPermission = 'read' | 'write' | 'network' | 'process';
export type IntegrationDescriptor = { id: string; name: string; description: string; version?: string; origin: IntegrationOrigin; source: string; status: IntegrationStatus; capabilities: IntegrationCapability[]; requestedPermissions: IntegrationPermission[]; allowedAgents: Partial<Record<AgentRole, 'read-only' | 'read-write' | 'none'>>; processOwnedByLgs: boolean };
export type ExternalTool = { integrationId: string; id: string; description: string; schema: JsonSchema; permission: ToolPermission };
export type IntegrationConfiguration = { required: string[]; recommended: string[]; optional: string[]; mcp: Record<string, { transport: 'stdio' | 'remote'; command?: string; args?: string[]; url?: string }> };
