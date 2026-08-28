import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentWorkspaceService } from '../src/agents/workspace.js';
import { contextPercent, contextUsage } from '../src/interaction/context.js';
import { FileActivityStore, MemoryActivityStore, RequestExecutionService } from '../src/interaction/execution.js';
import { executionModePolicy } from '../src/interaction/modes.js';
import { ManagedOllamaService, isLocalOllamaEndpoint } from '../src/model/ollama-runtime.js';
import { normalizeProfile } from '../src/model/profiles.js';
import { WorkspaceSkillStore } from '../src/knowledge/skills.js';

const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lgs-phase29-'));
const cleanup = (root: string) => fs.rmSync(root, { recursive: true, force: true });
const ollama = (baseUrl = 'http://localhost:11434') => normalizeProfile({ id: 'local', name: 'Local', kind: 'ollama', baseUrl, enabled: true, ollamaManagement: { mode: 'lgs-managed', autoStart: true } });
function child() {
  const value = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; pid: number; kill(signal?: string): boolean };
  value.stdout = new PassThrough(); value.stderr = new PassThrough(); value.pid = 4242; value.kill = () => { value.emit('exit', 0, 'SIGTERM'); return true; }; return value;
}

describe('Phase 29 request, phase, activity, and context contracts', () => {
  it('keeps one request timer across ordered phases and persists associated events', () => {
    const root = fixture(); const store = new FileActivityStore(root); const service = new RequestExecutionService(store);
    service.start('request-1', 'Implement Phase 29', 'normal', '2026-08-27T10:00:00.000Z');
    service.finishPhase('request-1', 'understand', 'completed', 'Understood', '2026-08-27T10:00:20.000Z'); service.startPhase('request-1', 'inspect', '2026-08-27T10:00:20.000Z');
    service.event('request-1', 'file', 'Read src/extension.ts', { phaseId: 'inspect', resource: { kind: 'file', value: 'src/extension.ts' } }, '2026-08-27T10:00:22.000Z'); service.finish('request-1', 'completed', undefined, '2026-08-27T10:01:00.000Z');
    expect(store.request('request-1')).toMatchObject({ startedAt: '2026-08-27T10:00:00.000Z', endedAt: '2026-08-27T10:01:00.000Z', status: 'completed' });
    const events = store.events('request-1'); expect(events.map(item => item.timestamp)).toEqual([...events.map(item => item.timestamp)].sort()); expect(events.find(item => item.type === 'file')).toMatchObject({ requestId: 'request-1', phaseId: 'inspect' }); cleanup(root);
  });
  it('derives composable mode policies and never invents unavailable context values', () => {
    expect(executionModePolicy('research').capabilities).toEqual(expect.arrayContaining(['plan', 'web', 'edit', 'verify', 'iterate'])); expect(executionModePolicy('plan').capabilities).not.toContain('edit');
    const unavailable = contextUsage(undefined, undefined); expect(unavailable).toMatchObject({ estimated: false, reason: expect.stringContaining('not reported') }); expect('used' in unavailable).toBe(false); expect(contextPercent(contextUsage(32_000, 128_000))).toBe(25); expect(contextPercent(contextUsage(undefined, 128_000))).toBeUndefined();
  });
  it('maintains in-memory execution state when no workspace is open', () => { const service = new RequestExecutionService(new MemoryActivityStore()); expect(service.start('r', 'Ask', 'web').phases.map(item => item.id)).toEqual(['understand', 'inspect', 'verify']); });
});

describe('Phase 29 managed Ollama ownership', () => {
  it('recognizes common local endpoints and refuses remote auto-start', async () => {
    expect(['http://localhost:11434', 'http://127.0.0.1:11434', 'http://[::1]:11434', 'http://0.0.0.0:11434'].every(isLocalOllamaEndpoint)).toBe(true); let spawned = 0;
    const service = new ManagedOllamaService({ findExecutable: () => '/bin/ollama', spawnProcess: () => { spawned += 1; return child() as never; } }); const info = await service.initialize(ollama('https://ollama.example.test'), async () => false);
    expect(info).toMatchObject({ ownership: 'none', state: 'offline' }); expect(spawned).toBe(0);
  });
  it('marks an already healthy endpoint external and never terminates it', async () => { const service = new ManagedOllamaService(); expect(await service.initialize(ollama(), async () => true)).toMatchObject({ ownership: 'external', state: 'running' }); expect(await service.stop('local')).toBe(false); expect((await service.restart(ollama(), async () => true)).message).toContain('only'); });
  it('reports a missing executable without retrying or spawning', async () => { let spawned = 0; const service = new ManagedOllamaService({ findExecutable: () => undefined, spawnProcess: () => { spawned += 1; return child() as never; } }); expect(await service.initialize(ollama(), async () => false)).toMatchObject({ ownership: 'none', state: 'error', message: expect.stringContaining('not found') }); expect(spawned).toBe(0); });
  it('owns successful starts, captures bounded logs, and restarts only its child', async () => {
    const children = [child(), child()]; let probe = 0; const service = new ManagedOllamaService({ findExecutable: () => '/bin/ollama', spawnProcess: () => children.shift() as never, wait: async () => {}, attempts: 2, logLimit: 2 });
    const started = await service.start(ollama(), async () => ++probe > 1); expect(started).toMatchObject({ ownership: 'lgs-managed', state: 'running', pid: 4242 }); expect(service.logs('local').at(-1)?.text).toContain('Started');
    const restarted = await service.restart(ollama(), async () => true); expect(restarted).toMatchObject({ ownership: 'lgs-managed', state: 'running' });
  });
  it('retains ownership on a bounded failed startup', async () => { const service = new ManagedOllamaService({ findExecutable: () => '/bin/ollama', spawnProcess: () => child() as never, wait: async () => {}, attempts: 2 }); expect(await service.start(ollama(), async () => false)).toMatchObject({ ownership: 'lgs-managed', state: 'error', message: expect.stringContaining('deadline') }); });
});

describe('Phase 29 agent workspace and skills', () => {
  it('initializes only missing compatible files and creates collision-safe project skills', () => {
    const root = fixture(); fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Existing\n'); const workspace = new AgentWorkspaceService(root); expect(workspace.initialize().initialized).toBe(true); expect(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')).toBe('# Existing\n');
    const skills = new WorkspaceSkillStore(root); const created = skills.create({ name: 'Frontend Design', description: 'Visible UI work', instructions: 'Inspect rendered UI.' }); expect(created.path).toBe('.agents/skills/frontend-design/SKILL.md'); expect(() => skills.create({ name: 'Frontend Design', description: 'Duplicate', instructions: 'No.' })).toThrow('already exists'); cleanup(root);
  });
});
