import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { CommandExecutionService, CommandPermissionResolver, CompletionGuard, FileCompletionEvidenceStore, FileRuntimeStore, ManagedProcessManager, RuntimeVerifier, ToolExecutor, createWorkspaceToolRegistry, loadWorkspaceConfiguration, parseCompletionConfiguration } from '../src/tools/index.js';

function fixture(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'lgs-runtime-')); }
function cleanup(root: string): void { fs.rmSync(root, { recursive: true, force: true }); }
function service(root: string): CommandExecutionService { return new CommandExecutionService(root, new CommandPermissionResolver({}, {}, 'always_allow')); }

describe('Phase 15 runtime verification', () => {
  it('parses generic runtime startup, health, and browser acceptance configuration', () => {
    const root = fixture(); fs.mkdirSync(path.join(root, '.lgs'));
    fs.writeFileSync(path.join(root, '.lgs', 'config.yaml'), ['runtime:', '  start:', '    command: npm', '    args: [run, dev]', '  healthcheck:', '    url: http://localhost:3000', '    expectedStatus: 200', '  acceptance:', '    - type: browser_open', '      url: http://localhost:3000', '    - type: browser_get_text', '      selector: "#login"', '      expectedText: Login'].join('\n'));
    const loaded = loadWorkspaceConfiguration(root);
    expect(loaded.errors).toEqual([]); expect(loaded.runtime).toMatchObject({ start: { command: 'npm', args: ['run', 'dev'] }, healthcheck: { expectedStatus: 200 }, acceptance: [{ type: 'browser_open' }, { type: 'browser_get_text' }] }); cleanup(root);
  });

  it('tracks and stops only LGS-owned child processes with retained output', async () => {
    const root = fixture(); const processes = new ManagedProcessManager(root, service(root));
    const record = await processes.start({ command: process.execPath, args: ['-e', 'console.log("ready"); setInterval(() => {}, 1000)'] }, 'phase-15');
    expect(record).toMatchObject({ taskId: 'phase-15', state: 'running', lgsStarted: true });
    await new Promise(resolve => setTimeout(resolve, 30)); expect(processes.get(record.id)?.stdout.join('\n')).toContain('ready');
    expect(processes.stop('external-pid')).toBeUndefined(); expect(processes.stop(record.id)).toMatchObject({ state: 'stopped' });
    cleanup(root);
  });

  it('uses health checks as persisted runtime completion evidence without requiring browser verification for other projects', async () => {
    const root = fixture(); const server = http.createServer((_request, response) => { response.statusCode = 204; response.end(); }); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); const port = typeof address === 'object' && address ? address.port : 0;
    const processes = new ManagedProcessManager(root, service(root)); const store = new FileRuntimeStore(root); const verifier = new RuntimeVerifier({ healthcheck: { url: `http://127.0.0.1:${port}`, expectedStatus: 204, timeoutMs: 1_000 } }, processes, store, root);
    const record = await verifier.verify('phase-15'); expect(record.status).toBe('passed'); expect(store.latest('phase-15')?.checks).toEqual([expect.objectContaining({ name: 'healthcheck', status: 'passed' })]);
    const gates = parseCompletionConfiguration({ gates: { runtime_verification_passes: true, acceptance_criteria_addressed: false, implementation_complete: false, relevant_tests_added_or_updated: false, targeted_tests_pass: false, full_tests_pass: false, typecheck_passes: false, lint_passes: false, build_succeeds: false, documentation_current: false, codebase_map_current: false, independent_review_passes: false, no_unresolved_task_failures: false } });
    const guard = new CompletionGuard(root, gates, new FileCompletionEvidenceStore(root), { read: () => [] }, undefined, undefined, store); expect(guard.evaluate('phase-15').status).toBe('passed');
    const registry = createWorkspaceToolRegistry({ processes, runtimeVerifier: verifier, runtimeStore: store }); expect(registry.list().map(item => item.id)).toEqual(expect.arrayContaining(['start_runtime', 'stop_runtime', 'get_runtime_status', 'run_runtime_verification', 'browser_open', 'browser_click', 'browser_type', 'browser_get_text', 'browser_wait_for', 'browser_screenshot', 'browser_console', 'browser_network_errors']));
    await server.close(); cleanup(root);
  });

  it('does not run unowned process controls through browser tools', async () => {
    const root = fixture(); const processes = new ManagedProcessManager(root, service(root)); const store = new FileRuntimeStore(root); const verifier = new RuntimeVerifier({}, processes, store, root);
    const result = await new ToolExecutor(createWorkspaceToolRegistry({ processes, runtimeVerifier: verifier, runtimeStore: store }), root).execute({ id: 'stop_runtime', arguments: { processId: '1234' } }); expect(result.error?.code).toBe('not_found'); cleanup(root);
  });
});
