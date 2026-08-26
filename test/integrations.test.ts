import { describe, expect, it } from 'vitest';
import { IntegrationHub, ToolExecutor, ToolRegistry, registerIntegrationTools } from '../src/tools/index.js';

describe('Integration Hub', () => {
  it('normalizes external capabilities and enforces agent restrictions through LGS tools', async () => {
    const hub = new IntegrationHub();
    hub.register({ id: 'demo', name: 'Demo MCP', description: 'A local MCP server.', version: '1', origin: 'mcp', source: 'stdio:demo', status: 'healthy', capabilities: ['tool', 'resource'], requestedPermissions: ['read'], allowedAgents: { manager: 'read-write', reviewer: 'read-only', watchdog: 'none' }, processOwnedByLgs: true });
    hub.registerTool({ integrationId: 'demo', id: 'demo_lookup', description: 'Look up data.', schema: { type: 'object', properties: {}, additionalProperties: false }, permission: { access: 'read-only', scope: 'workspace', network: false, category: 'read-only' } }, () => ({ data: { ok: true }, resultCount: 1 }));
    const registry = registerIntegrationTools(new ToolRegistry(), hub); const executor = new ToolExecutor(registry, process.cwd());
    expect((await executor.execute({ id: 'demo_lookup', arguments: {} }, { agentRole: 'reviewer' })).status).toBe('success');
    expect((await executor.execute({ id: 'demo_lookup', arguments: {} }, { agentRole: 'watchdog' })).error?.message).toContain('not permitted');
    expect((await executor.execute({ id: 'list_integrations', arguments: {} })).data).toMatchObject({ integrations: [{ id: 'demo', origin: 'mcp' }] });
  });
});
