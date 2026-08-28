import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BackendProfile } from './profiles.js';

export type OllamaOwnership = 'none' | 'external' | 'lgs-managed';
export type OllamaRuntimeState = 'offline' | 'starting' | 'running' | 'error';
export type OllamaRuntimeInfo = { ownership: OllamaOwnership; state: OllamaRuntimeState; pid?: number; executable?: string; startedAt?: string; message?: string };
export type OllamaLogEntry = { at: string; stream: 'lifecycle' | 'stdout' | 'stderr'; text: string };
export type ManagedOllamaOptions = {
  spawnProcess?: (executable: string, args: string[]) => ChildProcessWithoutNullStreams;
  findExecutable?: (configured?: string) => string | undefined;
  wait?: (milliseconds: number) => Promise<void>;
  attempts?: number;
  logLimit?: number;
};

export class ManagedOllamaService {
  private processes = new Map<string, ChildProcessWithoutNullStreams>();
  private states = new Map<string, OllamaRuntimeInfo>();
  private logsByProfile = new Map<string, OllamaLogEntry[]>();
  private readonly spawnProcess: NonNullable<ManagedOllamaOptions['spawnProcess']>;
  private readonly findExecutable: NonNullable<ManagedOllamaOptions['findExecutable']>;
  private readonly wait: NonNullable<ManagedOllamaOptions['wait']>;
  private readonly attempts: number; private readonly logLimit: number;
  constructor(options: ManagedOllamaOptions = {}) {
    this.spawnProcess = options.spawnProcess || ((executable, args) => spawn(executable, args, { shell: false, stdio: 'pipe' }));
    this.findExecutable = options.findExecutable || findOllamaExecutable; this.wait = options.wait || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
    this.attempts = options.attempts ?? 6; this.logLimit = options.logLimit ?? 300;
  }
  info(profileId: string): OllamaRuntimeInfo { return this.states.get(profileId) || { ownership: 'none', state: 'offline' }; }
  logs(profileId: string): OllamaLogEntry[] { return [...(this.logsByProfile.get(profileId) || [])]; }
  async initialize(profile: BackendProfile, probe: () => Promise<boolean>): Promise<OllamaRuntimeInfo> {
    if (await probe()) return this.update(profile.id, { ownership: this.processes.has(profile.id) ? 'lgs-managed' : 'external', state: 'running', ...(this.info(profile.id).pid ? { pid: this.info(profile.id).pid } : {}) });
    if (!isLocalOllamaEndpoint(profile.baseUrl)) return this.update(profile.id, { ownership: 'none', state: 'offline', message: 'Remote endpoint is unavailable; local process management is disabled.' });
    if (profile.ollamaManagement?.mode !== 'lgs-managed' || !profile.ollamaManagement.autoStart) return this.update(profile.id, { ownership: 'none', state: 'offline', message: 'Automatic local management is disabled.' });
    return this.start(profile, probe);
  }
  async start(profile: BackendProfile, probe: () => Promise<boolean>): Promise<OllamaRuntimeInfo> {
    if (!isLocalOllamaEndpoint(profile.baseUrl)) return this.update(profile.id, { ownership: 'none', state: 'error', message: 'LGS will not start Ollama for a remote endpoint.' });
    const existing = this.processes.get(profile.id); if (existing) return this.info(profile.id);
    const executable = this.findExecutable(profile.ollamaManagement?.executable);
    if (!executable) return this.update(profile.id, { ownership: 'none', state: 'error', message: 'Ollama executable was not found.' });
    const child = this.spawnProcess(executable, ['serve']); this.processes.set(profile.id, child);
    const startedAt = new Date().toISOString(); this.update(profile.id, { ownership: 'lgs-managed', state: 'starting', pid: child.pid, executable, startedAt, message: 'Waiting for Ollama readiness.' });
    this.log(profile.id, 'lifecycle', `Started ${executable} serve${child.pid ? ` (PID ${child.pid})` : ''}.`);
    child.stdout.on('data', data => this.log(profile.id, 'stdout', String(data)));
    child.stderr.on('data', data => this.log(profile.id, 'stderr', String(data)));
    child.once('exit', (code, signal) => { this.processes.delete(profile.id); const current = this.info(profile.id); if (current.state !== 'offline') this.update(profile.id, { ...current, state: code === 0 ? 'offline' : 'error', message: `Managed Ollama exited${code === null ? '' : ` with code ${code}`}${signal ? ` (${signal})` : ''}.` }); });
    child.once('error', error => { this.processes.delete(profile.id); this.update(profile.id, { ownership: 'none', state: 'error', executable, startedAt, message: error.message }); this.log(profile.id, 'stderr', error.message); });
    for (let attempt = 0; attempt < this.attempts; attempt += 1) {
      if (await probe()) return this.update(profile.id, { ownership: 'lgs-managed', state: 'running', pid: child.pid, executable, startedAt });
      await this.wait(Math.min(250 * 2 ** attempt, 2_000));
    }
    this.update(profile.id, { ownership: 'lgs-managed', state: 'error', pid: child.pid, executable, startedAt, message: 'Ollama did not become ready before the startup deadline.' });
    return this.info(profile.id);
  }
  async restart(profile: BackendProfile, probe: () => Promise<boolean>): Promise<OllamaRuntimeInfo> {
    if (!this.processes.has(profile.id)) return this.update(profile.id, { ...this.info(profile.id), message: 'Restart is available only for an Ollama process started by LGS.' });
    await this.stop(profile.id); return this.start(profile, probe);
  }
  async stop(profileId: string): Promise<boolean> {
    const child = this.processes.get(profileId); if (!child) return false;
    this.processes.delete(profileId); child.kill('SIGTERM'); this.update(profileId, { ownership: 'none', state: 'offline', message: 'LGS-managed Ollama stopped.' }); this.log(profileId, 'lifecycle', 'Stopped LGS-managed Ollama.'); return true;
  }
  async dispose(): Promise<void> { await Promise.all([...this.processes.keys()].map(id => this.stop(id))); }
  private update(id: string, value: OllamaRuntimeInfo): OllamaRuntimeInfo { this.states.set(id, value); return value; }
  private log(id: string, stream: OllamaLogEntry['stream'], value: string): void { const rows = (this.logsByProfile.get(id) || []).concat(value.split(/\r?\n/).filter(Boolean).map(text => ({ at: new Date().toISOString(), stream, text: text.slice(0, 4_000) }))); this.logsByProfile.set(id, rows.slice(-this.logLimit)); }
}

export function isLocalOllamaEndpoint(value: string): boolean {
  try { const hostname = new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, ''); return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0'; } catch { return false; }
}
export function findOllamaExecutable(configured?: string): string | undefined {
  const candidates = [configured, ...String(process.env.PATH || '').split(path.delimiter).map(directory => path.join(directory, process.platform === 'win32' ? 'ollama.exe' : 'ollama'))].filter((item): item is string => Boolean(item));
  return candidates.find(candidate => { try { return fs.statSync(candidate).isFile(); } catch { return false; } });
}
