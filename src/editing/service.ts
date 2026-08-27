import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ToolFailure } from '../tools/types.js';
import { toolError } from '../tools/framework.js';
import type { FileTaskStateStore } from '../watchdog/state.js';
import type { EditKind, EditOperation, EditPermissionPrompt, FileSnapshot } from './types.js';

const MAX_CONTENT_BYTES = 2 * 1024 * 1024;

/** Workspace-only, optimistic-concurrency file mutations with durable task-local undo records. */
export class FileEditService {
  constructor(
    readonly workspaceRoot: string,
    private readonly prompt: EditPermissionPrompt,
    private readonly tasks?: FileTaskStateStore,
  ) {}

  async replace(taskId: string, requested: string, expectedHash: string, content: string): Promise<EditOperation> {
    this.validateTask(taskId); this.validateContent(content);
    let target = this.existingFile(requested);
    const before = snapshot(target); this.expect(before.hash, expectedHash, requested);
    await this.authorize('replace', requested);
    target = this.existingFile(requested); this.expect(hashFile(target), expectedHash, requested);
    atomicWrite(target, Buffer.from(content), before.mode);
    return this.record({ id: randomUUID(), taskId, kind: 'replace', path: portable(requested), before, afterHash: hashFile(target), createdAt: now() });
  }

  async create(taskId: string, requested: string, content: string): Promise<EditOperation> {
    this.validateTask(taskId); this.validateContent(content); this.newFile(requested);
    await this.authorize('create', requested);
    const target = this.newFile(requested);
    atomicWrite(target, Buffer.from(content), 0o644);
    return this.record({ id: randomUUID(), taskId, kind: 'create', path: portable(requested), afterHash: hashFile(target), createdAt: now() });
  }

  async delete(taskId: string, requested: string, expectedHash: string): Promise<EditOperation> {
    this.validateTask(taskId); let target = this.existingFile(requested); const before = snapshot(target);
    this.expect(before.hash, expectedHash, requested); await this.authorize('delete', requested);
    target = this.existingFile(requested); this.expect(hashFile(target), expectedHash, requested); fs.unlinkSync(target);
    return this.record({ id: randomUUID(), taskId, kind: 'delete', path: portable(requested), before, createdAt: now() });
  }

  async rename(taskId: string, requested: string, destination: string, expectedHash: string): Promise<EditOperation> {
    this.validateTask(taskId); let source = this.existingFile(requested); const before = snapshot(source);
    this.expect(before.hash, expectedHash, requested); this.newFile(destination);
    await this.authorize('rename', requested, destination);
    source = this.existingFile(requested); this.expect(hashFile(source), expectedHash, requested);
    const target = this.newFile(destination);
    fs.renameSync(source, target);
    return this.record({ id: randomUUID(), taskId, kind: 'rename', path: portable(requested), destination: portable(destination), before, afterHash: hashFile(target), createdAt: now() });
  }

  async undo(taskId: string, operationId: string): Promise<EditOperation> {
    this.validateTask(taskId); if (!/^[0-9a-f-]{36}$/i.test(operationId)) fail('invalid_request', 'Edit operation ID is invalid.');
    const operation = this.read(taskId, operationId); if (!operation) fail('not_found', 'Edit operation was not found.');
    if (operation.undoneAt) fail('conflict', 'Edit operation has already been undone.');
    await this.authorize('undo', operation.path, operation.destination);
    if (operation.kind === 'replace') {
      const target = this.existingFile(operation.path); this.expect(hashFile(target), operation.afterHash, operation.path);
      atomicWrite(target, Buffer.from(operation.before!.content, 'base64'), operation.before!.mode);
    } else if (operation.kind === 'create') {
      const target = this.existingFile(operation.path); this.expect(hashFile(target), operation.afterHash, operation.path); fs.unlinkSync(target);
    } else if (operation.kind === 'delete') {
      const target = this.newFile(operation.path); atomicWrite(target, Buffer.from(operation.before!.content, 'base64'), operation.before!.mode);
    } else {
      const source = this.pathForNew(operation.path); const target = this.existingFile(operation.destination!);
      if (fs.existsSync(source)) fail('conflict', 'Original path is no longer available for undo.');
      this.expect(hashFile(target), operation.afterHash, operation.destination!); fs.renameSync(target, source);
    }
    operation.undoneAt = now(); this.write(operation); this.untrack(operation); return operation;
  }

  fingerprint(requested: string): { path: string; hash: string; bytes: number } {
    const target = this.existingFile(requested); const stats = fs.statSync(target);
    return { path: portable(requested), hash: hashFile(target), bytes: stats.size };
  }

  private async authorize(operation: EditKind | 'undo', requested: string, destination?: string): Promise<void> {
    const allowed = await this.prompt({ operation, path: portable(requested), destination: destination ? portable(destination) : undefined });
    if (!allowed) fail('unsupported', 'Workspace edit was denied by policy.');
  }

  private existingFile(requested: string): string {
    const target = this.resolve(requested); let stats: fs.Stats;
    try { stats = fs.lstatSync(target); } catch { fail('not_found', `Workspace file not found: ${requested}`); }
    if (stats.isSymbolicLink()) fail('invalid_path', 'Editing through symbolic links is not allowed.');
    if (!stats.isFile()) fail('not_file', 'Editing requires a regular file.');
    const root = fs.realpathSync(this.workspaceRoot); const real = fs.realpathSync(target);
    if (!within(root, real)) fail('invalid_path', 'Workspace file resolves outside the workspace.');
    return real;
  }
  private newFile(requested: string): string { const target = this.pathForNew(requested); if (fs.existsSync(target)) fail('conflict', `Workspace path already exists: ${requested}`); return target; }
  private pathForNew(requested: string): string {
    const target = this.resolve(requested); const parent = path.dirname(target);
    let realParent: string; try { realParent = fs.realpathSync(parent); } catch { fail('not_found', 'Destination parent directory does not exist.'); }
    if (!within(fs.realpathSync(this.workspaceRoot), realParent)) fail('invalid_path', 'Destination parent escapes the workspace.'); return target;
  }
  private resolve(requested: string): string {
    if (!requested || requested.includes('\0') || path.isAbsolute(requested) || path.win32.isAbsolute(requested)) fail('invalid_path', 'Paths must be workspace-relative.');
    const normalized = portable(requested); if (normalized.split('/').includes('..')) fail('invalid_path', 'Parent-directory traversal is not allowed.');
    const root = fs.realpathSync(this.workspaceRoot); const target = path.resolve(root, normalized);
    if (!within(root, target)) fail('invalid_path', 'Path escapes the workspace.'); return target;
  }
  private validateContent(content: string): void { if (Buffer.byteLength(content) > MAX_CONTENT_BYTES) fail('output_limit', `Edited content may contain at most ${MAX_CONTENT_BYTES} bytes.`); }
  private validateTask(taskId: string): void { if (!/^[a-zA-Z0-9._-]{1,128}$/.test(taskId)) fail('invalid_request', 'Editing requires a valid task ID.'); }
  private expect(actual: string, expected: string | undefined, requested: string): void { if (!expected || !/^[0-9a-f]{64}$/i.test(expected)) fail('invalid_request', 'Expected hash must be a SHA-256 fingerprint from a current file read.'); if (actual !== expected) fail('conflict', `File changed after it was read: ${requested}`); }
  private record(operation: EditOperation): EditOperation { this.write(operation); this.track(operation); return operation; }
  private write(operation: EditOperation): void { const file = this.operationFile(operation.taskId, operation.id); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(operation, null, 2) + '\n'); }
  private read(taskId: string, id: string): EditOperation | undefined { try { return JSON.parse(fs.readFileSync(this.operationFile(taskId, id), 'utf8')) as EditOperation; } catch { return; } }
  private operationFile(taskId: string, id: string): string { return path.join(this.workspaceRoot, '.lgs', 'tasks', taskId, 'edits', `${id}.json`); }

  private track(operation: EditOperation): void {
    const task = this.tasks?.read(operation.taskId); if (!task) return;
    this.tasks?.update(operation.taskId, { recentModifications: [...task.recentModifications, ...operationPaths(operation)] });
  }

  private untrack(operation: EditOperation): void {
    const task = this.tasks?.read(operation.taskId); if (!task) return;
    const candidates = new Set(operationPaths(operation));
    const stillActive = new Set(this.operations(operation.taskId).filter(item => !item.undoneAt).flatMap(operationPaths));
    this.tasks?.update(operation.taskId, { recentModifications: task.recentModifications.filter(file => !candidates.has(file) || stillActive.has(file)) });
  }

  private operations(taskId: string): EditOperation[] {
    const directory = path.join(this.workspaceRoot, '.lgs', 'tasks', taskId, 'edits');
    try {
      return fs.readdirSync(directory).filter(name => /^[0-9a-f-]{36}\.json$/i.test(name)).flatMap(name => {
        try { return [JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')) as EditOperation]; }
        catch { return []; }
      });
    } catch { return []; }
  }
}

function snapshot(file: string): FileSnapshot { const stats = fs.statSync(file); const content = fs.readFileSync(file); return { content: content.toString('base64'), hash: hash(content), mode: stats.mode & 0o777 }; }
function atomicWrite(file: string, content: Buffer, mode: number): void { const temporary = path.join(path.dirname(file), `.lgs-edit-${randomUUID()}.tmp`); try { fs.writeFileSync(temporary, content, { mode }); fs.renameSync(temporary, file); fs.chmodSync(file, mode); } finally { try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch { /* Best effort temporary cleanup. */ } } }
function hashFile(file: string): string { return hash(fs.readFileSync(file)); }
function hash(value: Buffer): string { return createHash('sha256').update(value).digest('hex'); }
function portable(value: string): string { return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, ''); }
function within(root: string, candidate: string): boolean { const relative = path.relative(root, candidate); return relative === '' || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); }
function now(): string { return new Date().toISOString(); }
function operationPaths(operation: EditOperation): string[] { return [operation.path, operation.destination].filter((value): value is string => Boolean(value)); }
function fail(code: Parameters<typeof toolError>[0], message: string): never { throw new ToolFailure(toolError(code, message)); }
