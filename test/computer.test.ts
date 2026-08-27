import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ComputerAgent, ComputerPermissionResolver, ToolExecutor, ToolRegistry, parseComputerConfiguration, registerComputerTools } from '../src/tools/index.js';

function fixture(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'lgs-computer-')); }
function cleanup(root: string): void { fs.rmSync(root, { recursive: true, force: true }); }
const configuration = (trusted: string) => parseComputerConfiguration({ readOutsideWorkspace: 'deny', writeOutsideWorkspace: 'deny', trustedLocations: [{ path: trusted, read: 'always_allow', write: 'always_allow' }], systemCommandPolicy: 'always_allow', packageInstallationPolicy: 'deny', elevatedCommandPolicy: 'deny', dryRun: true });

describe('ComputerAgent', () => {
  it('resolves trusted paths separately from outside-workspace access and extracts structured documents', async () => {
    const root = fixture(); const external = fixture();
    fs.writeFileSync(path.join(external, 'idea.md'), '# Idea\nBuild a reliable document workflow.\n');
    fs.writeFileSync(path.join(external, 'data.csv'), 'name,value\nAda,1\n');
    const agent = new ComputerAgent(root, configuration(external));
    expect(new ComputerPermissionResolver(configuration(external), root).filesystem(path.join(external, 'idea.md'), 'read')).toMatchObject({ policy: 'always_allow', source: 'trusted-location' });
    expect((await agent.readFile(path.join(external, 'idea.md'))).text).toContain('reliable document');
    expect((await agent.readFile(path.join(external, 'data.csv'))).structured).toEqual([['name', 'value'], ['Ada', '1']]);
    await expect(agent.readFile(path.join(os.tmpdir(), 'not-trusted.txt'))).rejects.toThrow('denied');
    cleanup(root); cleanup(external);
  });

  it('plans commands by default and records a secret-safe activity, trace, and decision journal', async () => {
    const root = fixture(); const agent = new ComputerAgent(root, configuration(root));
    const planned = await agent.runCommand({ executable: process.execPath, args: ['-e', 'console.log("no")'], operation: 'system-inspection', reason: 'Inspect runtime' });
    expect(planned.status).toBe('planned');
    await agent.recordActivity({ taskId: 'computer-27', operation: 'inspect', target: 'host', permission: 'ask', result: 'planned', details: { password: 'never-record', release: 'ok' } });
    expect(JSON.stringify(agent.activities('computer-27'))).not.toContain('never-record');
    agent.recordTrace({ taskId: 'computer-27', agentId: 'agent-1', role: 'computer-agent', contextCategories: ['external-document'], toolsRequested: ['read_external_file'], toolsExecuted: ['read_external_file'], filesAffected: [], researchPerformed: [], retries: 0, escalations: [] });
    expect(agent.traces('computer-27')[0].role).toBe('computer-agent');
    agent.journal({ taskId: 'computer-27', decision: 'Use a dry run', conclusion: 'Approval is required before execution.', evidence: ['default computer policy'], confidence: 'high' });
    expect(agent.decisions('computer-27')[0].conclusion).toContain('Approval');
    cleanup(root);
  });

  it('registers external tools and rejects arbitrary shell-shaped command requests', async () => {
    const root = fixture(); const agent = new ComputerAgent(root, configuration(root)); const executor = new ToolExecutor(registerComputerTools(new ToolRegistry(), agent), root);
    expect(executor.registry.get('read_external_file')?.permission.scope).toBe('computer');
    const invalid = await executor.execute({ id: 'run_computer_command', arguments: { executable: 'node\nunsafe', args: [], operation: 'system-inspection', reason: 'bad' } });
    expect(invalid.status).toBe('error');
    cleanup(root);
  });
});
