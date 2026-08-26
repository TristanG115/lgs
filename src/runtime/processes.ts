import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CommandExecutionService } from '../execution/service.js';
import type { RuntimeStartConfiguration, ManagedProcessRecord } from './types.js';

const MAX_OUTPUT_LINES = 500;

export class ManagedProcessManager {
  private readonly processes = new Map<string, { child: ChildProcessWithoutNullStreams; record: ManagedProcessRecord }>();
  constructor(readonly workspaceRoot: string, private readonly execution: CommandExecutionService) {}

  async start(start: RuntimeStartConfiguration, taskId?: string): Promise<ManagedProcessRecord> {
    const request = { executable: start.command, args: start.args, cwd: start.cwd, env: start.env, category: 'process' as const, timeoutMs: start.timeoutMs, taskId };
    const allowed = await this.execution.authorize(request);
    const now = new Date().toISOString(); const id = randomUUID();
    const outputPath = path.join('.lgs', 'runtime', `${id}.log`);
    const record: ManagedProcessRecord = { id, command: start.command, args: [...start.args], taskId, state: allowed ? 'starting' : 'denied', readiness: 'unknown', startedAt: now, updatedAt: now, outputPath, stdout: [], stderr: [], lgsStarted: true };
    if (!allowed) return record;
    const cwd = path.resolve(this.workspaceRoot, start.cwd ?? '.');
    const environment = { ...process.env, ...start.env, LGS_COMMAND: '1' };
    let child: ChildProcessWithoutNullStreams;
    try { child = spawn(start.command, start.args, { cwd, env: environment, shell: false, windowsHide: true }); }
    catch (error) { record.state = 'crashed'; record.stderr = [error instanceof Error ? error.message : 'Unable to start process.']; record.updatedAt = new Date().toISOString(); return record; }
    record.pid = child.pid; record.state = 'running'; record.updatedAt = new Date().toISOString();
    const managed = { child, record }; this.processes.set(id, managed); child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => this.append(managed, 'stdout', String(chunk)));
    child.stderr.on('data', chunk => this.append(managed, 'stderr', String(chunk)));
    child.on('error', error => this.append(managed, 'stderr', error.message));
    child.on('close', (exitCode, signal) => { record.exitCode = exitCode; record.signal = signal; record.exitedAt = new Date().toISOString(); record.updatedAt = record.exitedAt; record.state = record.state === 'stopped' ? 'stopped' : exitCode === 0 ? 'exited' : 'crashed'; });
    return { ...record, stdout: [...record.stdout], stderr: [...record.stderr] };
  }

  list(taskId?: string): ManagedProcessRecord[] { return [...this.processes.values()].map(item => item.record).filter(item => !taskId || item.taskId === taskId).map(copy); }
  get(id: string): ManagedProcessRecord | undefined { const process = this.processes.get(id); return process ? copy(process.record) : undefined; }
  markReady(id: string, ready: boolean): ManagedProcessRecord | undefined { const item = this.processes.get(id); if (!item) return; item.record.readiness = ready ? 'ready' : 'not_ready'; if (ready && item.record.state === 'running') item.record.state = 'ready'; item.record.updatedAt = new Date().toISOString(); return copy(item.record); }
  stop(id: string): ManagedProcessRecord | undefined {
    const item = this.processes.get(id); if (!item) return; // Never act on a discovered PID: only this map contains LGS-owned children.
    if (!item.child.killed && ['starting', 'running', 'ready'].includes(item.record.state)) item.child.kill('SIGTERM');
    item.record.state = 'stopped'; item.record.updatedAt = new Date().toISOString(); return copy(item.record);
  }
  dispose(): void { for (const id of this.processes.keys()) this.stop(id); }

  private append(item: { record: ManagedProcessRecord }, stream: 'stdout' | 'stderr', chunk: string): void {
    const lines = chunk.split(/\r?\n/).filter(Boolean); item.record[stream].push(...lines); if (item.record[stream].length > MAX_OUTPUT_LINES) item.record[stream].splice(0, item.record[stream].length - MAX_OUTPUT_LINES);
    item.record.updatedAt = new Date().toISOString(); const file = path.join(this.workspaceRoot, item.record.outputPath); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, `${stream}: ${chunk}`);
  }
}
function copy(record: ManagedProcessRecord): ManagedProcessRecord { return { ...record, args: [...record.args], stdout: [...record.stdout], stderr: [...record.stderr] }; }
