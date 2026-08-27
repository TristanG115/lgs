import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { IntegrationHub, ToolExecutor, ToolRegistry, registerIntegrationTools } from '../src/tools/index.js';
import { loadWorkspaceConfiguration } from '../src/verification/config.js';

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
  it('retains validated MCP configuration while rejecting malformed transports', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lgs-integrations-')); fs.mkdirSync(path.join(root, '.lgs'));
    fs.writeFileSync(path.join(root, '.lgs', 'config.yaml'), 'integrations:\n  mcp:\n    docs:\n      transport: stdio\n      command: docs-server\n      args: [--stdio]\n    bad:\n      transport: remote\n      url: file:///unsafe\n');
    const configuration = loadWorkspaceConfiguration(root);
    expect(configuration.integrations?.mcp.docs).toEqual({ transport: 'stdio', command: 'docs-server', args: ['--stdio'] });
    expect(configuration.integrations?.mcp.bad).toBeUndefined(); expect(configuration.errors.join(' ')).toContain('integrations.mcp.bad');
    fs.rmSync(root, { recursive: true, force: true });
  });
});
