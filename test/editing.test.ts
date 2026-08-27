import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileEditService, FileTaskStateStore, ToolExecutor, ToolRegistry, registerEditingTools } from '../src/tools/index.js';

const fixtures: string[] = [];

function fixture(): { root: string; tasks: FileTaskStateStore; service: FileEditService } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lgs-editing-'));
  fixtures.push(root);
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'main.ts'), 'export const value = 1;\n');
  const tasks = new FileTaskStateStore(root);
  tasks.ensure('task-1', 'Safely edit the fixture.');
  return { root, tasks, service: new FileEditService(root, async () => true, tasks) };
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

afterEach(() => {
  for (const root of fixtures.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('workspace editing', () => {
  it('replaces, creates, deletes, renames, and durably undoes files', async () => {
    const { root, tasks, service } = fixture();
    const original = fs.readFileSync(path.join(root, 'src', 'main.ts'), 'utf8');

    const replacement = await service.replace('task-1', 'src/main.ts', hash(original), 'export const value = 2;\n');
    expect(fs.readFileSync(path.join(root, 'src', 'main.ts'), 'utf8')).toContain('value = 2');
    expect(tasks.read('task-1')?.recentModifications).toContain('src/main.ts');
    expect(fs.existsSync(path.join(root, '.lgs', 'tasks', 'task-1', 'edits', `${replacement.id}.json`))).toBe(true);
    await service.undo('task-1', replacement.id);
    expect(fs.readFileSync(path.join(root, 'src', 'main.ts'), 'utf8')).toBe(original);
    expect(tasks.read('task-1')?.recentModifications).not.toContain('src/main.ts');

    const created = await service.create('task-1', 'src/new.ts', 'export const created = true;\n');
    expect(fs.existsSync(path.join(root, 'src', 'new.ts'))).toBe(true);
    await service.undo('task-1', created.id);
    expect(fs.existsSync(path.join(root, 'src', 'new.ts'))).toBe(false);

    const deleted = await service.delete('task-1', 'src/main.ts', hash(original));
    expect(fs.existsSync(path.join(root, 'src', 'main.ts'))).toBe(false);
    await service.undo('task-1', deleted.id);
    expect(fs.readFileSync(path.join(root, 'src', 'main.ts'), 'utf8')).toBe(original);

    const renamed = await service.rename('task-1', 'src/main.ts', 'src/renamed.ts', hash(original));
    expect(fs.existsSync(path.join(root, 'src', 'renamed.ts'))).toBe(true);
    expect(tasks.read('task-1')?.recentModifications).toEqual(expect.arrayContaining(['src/main.ts', 'src/renamed.ts']));
    await service.undo('task-1', renamed.id);
    expect(fs.existsSync(path.join(root, 'src', 'main.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'src', 'renamed.ts'))).toBe(false);
  });

  it('rechecks optimistic concurrency after permission is granted', async () => {
    const { root, tasks } = fixture();
    const target = path.join(root, 'src', 'main.ts');
    const original = fs.readFileSync(target, 'utf8');
    const service = new FileEditService(root, async () => {
      fs.writeFileSync(target, 'const userChange = true;\n');
      return true;
    }, tasks);

    await expect(service.replace('task-1', 'src/main.ts', hash(original), 'const modelChange = true;\n'))
      .rejects.toMatchObject({ toolError: { code: 'conflict' } });
    expect(fs.readFileSync(target, 'utf8')).toBe('const userChange = true;\n');
  });

  it('rejects traversal, escaping intermediate symlinks, overwrite, and denied edits', async () => {
    const { root, tasks, service } = fixture();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'lgs-editing-outside-'));
    fixtures.push(outside);
    fs.writeFileSync(path.join(outside, 'secret.ts'), 'export const secret = true;\n');
    fs.symlinkSync(outside, path.join(root, 'linked'));

    expect(() => service.fingerprint('../secret.ts')).toThrow();
    expect(() => service.fingerprint('linked/secret.ts')).toThrow();
    await expect(service.create('task-1', 'src/main.ts', 'overwrite'))
      .rejects.toMatchObject({ toolError: { code: 'conflict' } });

    const denied = new FileEditService(root, async () => false, tasks);
    await expect(denied.create('task-1', 'src/denied.ts', 'no'))
      .rejects.toMatchObject({ toolError: { code: 'unsupported' } });
    expect(fs.existsSync(path.join(root, 'src', 'denied.ts'))).toBe(false);
  });

  it('registers editing tools, requires task identity, and remains read-only in Planning Mode', async () => {
    const { root, service } = fixture();
    const registry = registerEditingTools(new ToolRegistry(), service);
    expect(registry.list().map(item => item.id)).toEqual([
      'get_file_fingerprint', 'replace_file', 'create_file', 'delete_file', 'rename_file', 'undo_edit',
    ]);
    const executor = new ToolExecutor(registry, root);
    const call = { id: 'create_file', arguments: { path: 'src/tool.ts', content: 'export {};\n' } };

    expect((await executor.execute(call)).error?.code).toBe('invalid_request');
    expect((await executor.execute(call, { taskId: 'task-1', taskMode: 'planning' })).error?.code).toBe('unsupported');
    expect((await executor.execute(call, { taskId: 'task-1', taskMode: 'implementation' })).status).toBe('success');
    expect(fs.existsSync(path.join(root, 'src', 'tool.ts'))).toBe(true);
  });
});
