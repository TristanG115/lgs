import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TaskEvidenceSink } from './evidence.js';
import { RawExecutionLogStore } from './logs.js';
import { normalizeOutput } from './normalize.js';
import { CommandPermissionResolver } from './permissions.js';
import { COMMAND_CATEGORIES, type ExecutionRequest, type ExecutionResult, type PermissionPrompt } from './types.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 30 * 60_000;
const INHERITED_ENV = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'WINDIR', 'PATHEXT', 'LANG', 'LC_ALL'] as const;

export class CommandExecutionService {
  constructor(
    private readonly workspaceRoot: string,
    private readonly permissions: CommandPermissionResolver,
    readonly logs = new RawExecutionLogStore(workspaceRoot),
    private readonly evidence?: TaskEvidenceSink,
    private readonly prompt?: PermissionPrompt
  ) {}

  /** Performs the same validation and permission prompt used by one-shot commands. */
  async authorize(request: ExecutionRequest): Promise<boolean> {
    validateRequest(this.workspaceRoot, request);
    const permission = this.permissions.resolve(request);
    return permission.policy !== 'deny' && (permission.policy !== 'ask' || Boolean(await this.prompt?.(request)));
  }

  async execute(request: ExecutionRequest, signal: AbortSignal = new AbortController().signal): Promise<ExecutionResult> {
    const validated = validateRequest(this.workspaceRoot, request);
    const startedAt = new Date();
    const id = randomUUID();
    if (!(await this.authorize(request))) {
      return await this.finish(id, request, startedAt, 'denied', null, null, false, '', '', undefined);
    }
    if (signal.aborted) return await this.finish(id, request, startedAt, 'cancelled', null, null, false, '', '', undefined);
    const timeoutMs = Math.min(request.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    const environment = controlledEnvironment(request.env);
    return await new Promise<ExecutionResult>(resolve => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(request.executable, request.args, { cwd: validated.cwd, env: environment, shell: false, windowsHide: true });
      } catch (error) {
        const stderr = error instanceof Error ? error.message : 'Unable to spawn command.';
        void this.finish(id, request, startedAt, 'spawn_error', null, null, false, '', stderr, undefined).then(resolve); return;
      }
      let stdout = '', stderr = '', timedOut = false, settled = false;
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => { stdout += String(chunk); });
      child.stderr.on('data', chunk => { stderr += String(chunk); });
      const terminate = (reason: 'cancelled' | 'timed_out') => {
        if (settled) return;
        timedOut = reason === 'timed_out';
        child.kill('SIGTERM');
        setTimeout(() => { if (!settled) child.kill('SIGKILL'); }, 1_000).unref();
      };
      const onAbort = () => terminate('cancelled');
      signal.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => terminate('timed_out'), timeoutMs);
      child.on('error', error => { stderr += (stderr ? '\n' : '') + error.message; });
      child.on('close', (code, childSignal) => {
        settled = true; clearTimeout(timer); signal.removeEventListener('abort', onAbort);
        const status = timedOut ? 'timed_out' : signal.aborted ? 'cancelled' : code === 0 ? 'passed' : code === null && stderr ? 'spawn_error' : 'failed';
        const rawLogId = this.logs.put(id, { stdout, stderr });
        void this.finish(id, request, startedAt, status, code, childSignal, timedOut, stdout, stderr, rawLogId).then(resolve);
      });
    });
  }

  private async finish(id: string, request: ExecutionRequest, startedAt: Date, status: ExecutionResult['status'], exitCode: number | null, childSignal: NodeJS.Signals | null, timedOut: boolean, stdout: string, stderr: string, rawLogId?: string): Promise<ExecutionResult> {
    const completedAt = new Date();
    const result: ExecutionResult = {
      id, request: { ...request, envKeys: Object.keys(request.env ?? {}).sort(), env: undefined } as ExecutionResult['request'],
      status, startedAt: startedAt.toISOString(), completedAt: completedAt.toISOString(), durationMs: completedAt.getTime() - startedAt.getTime(),
      exitCode, signal: childSignal, timedOut, rawLogId, normalized: normalizeOutput(request, exitCode, stdout, stderr)
    };
    if (request.taskId) await Promise.resolve(this.evidence?.recordExecution(request.taskId, result)).catch(() => undefined);
    return result;
  }
}

function validateRequest(workspaceRoot: string, request: ExecutionRequest): { cwd: string } {
  if (typeof request.executable !== 'string' || !request.executable.trim() || request.executable.includes('\0') || /[\r\n]/.test(request.executable)) throw new Error('Executable must be a non-empty program name or path.');
  if (!Array.isArray(request.args) || request.args.some(argument => typeof argument !== 'string' || argument.includes('\0'))) throw new Error('Command arguments must be an array of strings without null bytes.');
  if (!COMMAND_CATEGORIES.includes(request.category)) throw new Error('Command category is invalid.');
  if (request.timeoutMs !== undefined && (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > MAX_TIMEOUT_MS)) throw new Error(`Timeout must be from 1 to ${MAX_TIMEOUT_MS} milliseconds.`);
  for (const [key, value] of Object.entries(request.env ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== 'string' || value.includes('\0')) throw new Error('Environment overrides must use valid names and string values.');
  }
  const root = fs.realpathSync(workspaceRoot);
  const candidate = path.resolve(root, request.cwd ?? '.');
  let cwd: string;
  try { cwd = fs.realpathSync(candidate); } catch { throw new Error('Command working directory does not exist.'); }
  const relative = path.relative(root, cwd);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Command working directory must stay inside the workspace.');
  return { cwd };
}

function controlledEnvironment(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of INHERITED_ENV) if (process.env[key] !== undefined) environment[key] = process.env[key];
  for (const [key, value] of Object.entries(overrides)) environment[key] = value;
  environment.LGS_COMMAND = '1';
  return environment;
}
