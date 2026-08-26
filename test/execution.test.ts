import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  CommandExecutionService, CommandPermissionResolver, FileTaskEvidenceStore, RawExecutionLogStore,
  VerificationRunner, loadWorkspaceConfiguration, normalizeOutput
} from '../src/tools/index.js';

function fixture(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'lgs-execution-')); }
function cleanup(root: string): void { fs.rmSync(root, { recursive: true, force: true }); }
function request(overrides: Record<string, unknown> = {}) {
  return { executable: process.execPath, args: ['-e', 'console.log("ok")'], category: 'test' as const, ...overrides };
}

describe('controlled command execution', () => {
  it('uses argument arrays, a workspace cwd, controlled environment, and raw log retrieval', async () => {
    const root = fixture();
    const logs = new RawExecutionLogStore(root);
    const service = new CommandExecutionService(root, new CommandPermissionResolver({}, {}, 'always_allow'), logs);
    const hostile = '$(touch should-not-exist)';
    const result = await service.execute(request({
      args: ['-e', 'console.log(process.argv[1]); console.error(process.env.LGS_VISIBLE + ":" + process.env.LGS_COMMAND)', hostile],
      env: { LGS_VISIBLE: 'yes' }, cwd: '.'
    }));
    expect(result).toMatchObject({ status: 'passed', exitCode: 0, timedOut: false });
    expect(result.normalized.stdout).toContain(hostile);
    expect(result.normalized.stderr).toContain('yes:1');
    expect(fs.existsSync(path.join(root, 'should-not-exist'))).toBe(false);
    expect(result.rawLogId).toBeTypeOf('string');
    expect(logs.page(result.rawLogId!, 'stdout', 0, 10)?.lines).toContain(hostile);
    expect(JSON.stringify(result.request)).not.toContain('LGS_VISIBLE":"yes');
    cleanup(root);
  });

  it('enforces deny and ask policies before spawning', async () => {
    const root = fixture();
    let prompts = 0;
    const denied = new CommandExecutionService(root, new CommandPermissionResolver({}, { categories: { test: 'deny' } }, 'always_allow'));
    expect((await denied.execute(request())).status).toBe('denied');
    const asked = new CommandExecutionService(root, new CommandPermissionResolver({}, {}, 'ask'), undefined, undefined, async () => { prompts++; return true; });
    expect((await asked.execute(request())).status).toBe('passed');
    expect(prompts).toBe(1);
    cleanup(root);
  });

  it('rejects workspace escape and invalid structured fields', async () => {
    const root = fixture();
    const service = new CommandExecutionService(root, new CommandPermissionResolver({}, {}, 'always_allow'));
    await expect(service.execute(request({ cwd: '..' }))).rejects.toThrow('inside the workspace');
    await expect(service.execute(request({ args: 'echo unsafe' }))).rejects.toThrow('array of strings');
    await expect(service.execute(request({ executable: 'node\nother' }))).rejects.toThrow('Executable');
    cleanup(root);
  });

  it('supports timeout and cancellation', async () => {
    const root = fixture();
    const service = new CommandExecutionService(root, new CommandPermissionResolver({}, {}, 'always_allow'));
    const timedOut = await service.execute(request({ args: ['-e', 'setInterval(() => {}, 1000)'], timeoutMs: 30 }));
    expect(timedOut.status).toBe('timed_out');
    const controller = new AbortController();
    const pending = service.execute(request({ args: ['-e', 'setInterval(() => {}, 1000)'], timeoutMs: 5_000 }), controller.signal);
    setTimeout(() => controller.abort(), 30);
    expect((await pending).status).toBe('cancelled');
    cleanup(root);
  });

  it('normalizes noisy failures while preserving important diagnostics', () => {
    const stdout = Array.from({ length: 1_000 }, (_, index) => `log ${index}`).join('\n');
    const stderr = 'Error: broken assertion\n    at run (src/auth.ts:42:7)\nsrc/auth.test.ts:18:3 failed';
    const normalized = normalizeOutput(request(), 1, stdout, stderr);
    expect(normalized.primaryError).toContain('Error: broken assertion');
    expect(normalized.relevantStack).toContain('    at run (src/auth.ts:42:7)');
    expect(normalized.fileLocations).toEqual(expect.arrayContaining(['src/auth.ts:42:7', 'src/auth.test.ts:18:3']));
    expect(normalized.omittedLineCount).toBeGreaterThan(900);
    expect(normalized.stdout.length).toBeLessThanOrEqual(24);
  });

  it('persists execution results as task evidence', async () => {
    const root = fixture();
    const evidence = new FileTaskEvidenceStore(root);
    const service = new CommandExecutionService(root, new CommandPermissionResolver({}, {}, 'always_allow'), new RawExecutionLogStore(root), evidence);
    await service.execute(request({ taskId: 'task-8', verificationStep: 'test' }));
    expect(evidence.read('task-8')).toMatchObject([{ kind: 'command-execution', taskId: 'task-8', verificationStep: 'test', execution: { status: 'passed' } }]);
    cleanup(root);
  });
});

describe('generic and targeted verification configuration', () => {
  it('loads generic command definitions without assuming a package manager', () => {
    const root = fixture();
    fs.mkdirSync(path.join(root, '.lgs'));
    fs.writeFileSync(path.join(root, '.lgs', 'config.yaml'), [
      'verification:', '  typecheck:', '    executable: cargo', '    args: [check]', '    category: build',
      '  targetedTest:', '    - executable: pytest', '      args: ["{targets}"]', '      category: test', '      include: ["src/auth/**"]',
      'permissions:', '  commands:', '    default: ask', '    categories:', '      test: always_allow'
    ].join('\n'));
    const loaded = loadWorkspaceConfiguration(root);
    expect(loaded.errors).toEqual([]);
    expect(loaded.verification.typecheck?.[0]).toMatchObject({ executable: 'cargo', args: ['check'], category: 'build' });
    expect(loaded.permissions.categories?.test).toBe('always_allow');
    cleanup(root);
  });

  it('selects targeted commands by changed paths and expands targets as arguments', async () => {
    const root = fixture();
    const service = new CommandExecutionService(root, new CommandPermissionResolver({}, {}, 'always_allow'));
    const runner = new VerificationRunner({ targetedTest: [{
      executable: process.execPath, args: ['-e', 'console.log(process.argv.slice(1).join("|"))', '{targets}'], category: 'test', include: ['src/auth/**']
    }] }, service);
    expect((await runner.run('targetedTest', { targets: ['src/other/file.ts'] })).status).toBe('not_configured');
    const result = await runner.run('targetedTest', { targets: ['src/auth/login.ts', 'src/auth/token.ts'] });
    expect(result.status).toBe('passed');
    expect(result.executions[0].normalized.stdout.join('\n')).toContain('src/auth/login.ts|src/auth/token.ts');
    cleanup(root);
  });
});

