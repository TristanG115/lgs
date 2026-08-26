import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MemoryAuditSink, READ_ONLY_WORKSPACE_PERMISSION, ToolExecutor, ToolRegistry, createRepositoryToolRegistry, runToolLoop, type ToolLoopModel } from '../src/tools/index.js';
import { textMessage } from '../src/model/types.js';

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lgs-tools-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'test'));
  fs.writeFileSync(path.join(root, 'src', 'util.ts'), 'export function helper(value: string) {\n  return value.trim();\n}\n');
  fs.writeFileSync(path.join(root, 'src', 'main.ts'), 'import { helper } from "./util.js";\nexport function run() {\n  return helper(" ok ");\n}\n');
  fs.writeFileSync(path.join(root, 'test', 'main.test.ts'), 'import { run } from "../src/main.js";\nit("runs", () => run());\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { yaml: '^2.0.0' }, devDependencies: { vitest: '^2.0.0' } }));
  fs.writeFileSync(path.join(root, 'README.md'), '# Fixture\n\nSmall repository.\n');
  return root;
}
function cleanup(root: string): void { fs.rmSync(root, { recursive: true, force: true }); }
function call(id: string, arguments_: Record<string, unknown>, callId = 'call-1') { return { id, callId, arguments: arguments_ }; }

describe('read-only workspace tools', () => {
  it('registers every Phase 4 tool with read-only permission metadata', () => {
    const registry = createRepositoryToolRegistry();
    expect(registry.list().map(tool => tool.id)).toEqual([
      'list_directory', 'read_file', 'read_file_range', 'search_workspace', 'find_symbol', 'find_references',
      'get_file_summary', 'get_codebase_map_section', 'get_project_dependencies', 'get_related_tests', 'get_related_files'
    ]);
    expect(registry.list().every(tool => tool.permission.access === 'read-only' && tool.permission.network === false)).toBe(true);
  });

  it('reads ranges, paginates listings, and returns continuation metadata', async () => {
    const root = fixture();
    const executor = new ToolExecutor(createRepositoryToolRegistry(), root);
    const first = await executor.execute(call('list_directory', { path: '.', recursive: true, pageSize: 2 }));
    expect(first.status).toBe('success');
    expect(first.metadata.truncated).toBe(true);
    expect(first.metadata.continuationToken).toBeTypeOf('string');
    const second = await executor.execute(call('list_directory', { path: '.', recursive: true, pageSize: 2, continuationToken: first.metadata.continuationToken }));
    expect((second.data as { offset: number }).offset).toBe(2);
    const range = await executor.execute(call('read_file_range', { path: 'src/main.ts', startLine: 2, endLine: 3 }));
    expect((range.data as { content: string }).content).toContain('2: export function run()');
    expect((range.data as { content: string }).content).not.toContain('1: import');
    cleanup(root);
  });

  it('uses repository intelligence for symbols, dependencies, summaries, and relationships', async () => {
    const root = fixture();
    const executor = new ToolExecutor(createRepositoryToolRegistry(), root);
    const symbol = await executor.execute(call('find_symbol', { symbol: 'run' }));
    expect(JSON.stringify(symbol.data)).toContain('src/main.ts');
    expect(symbol.metadata.source).toBe('repository-index');
    const references = await executor.execute(call('find_references', { symbol: 'helper' }));
    expect(JSON.stringify(references.data)).toContain('src/main.ts');
    const dependencies = await executor.execute(call('get_project_dependencies', {}));
    expect(JSON.stringify(dependencies.data)).toContain('vitest');
    const related = await executor.execute(call('get_related_files', { path: 'src/main.ts' }));
    expect(JSON.stringify(related.data)).toContain('src/util.ts');
    const tests = await executor.execute(call('get_related_tests', { path: 'src/main.ts' }));
    expect(JSON.stringify(tests.data)).toContain('test/main.test.ts');
    const summary = await executor.execute(call('get_file_summary', { path: 'src/main.ts' }));
    expect(summary.data).toMatchObject({ path: 'src/main.ts', entryPoint: false });
    const map = await executor.execute(call('get_codebase_map_section', { section: 'Dependencies' }));
    expect(JSON.stringify(map.data)).toContain('yaml');
    cleanup(root);
  });

  it('searches with bounded previews and continuation tokens', async () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, 'src', 'many.ts'), Array.from({ length: 30 }, (_, index) => `export const value${index} = "needle";`).join('\n'));
    const executor = new ToolExecutor(createRepositoryToolRegistry(), root);
    const result = await executor.execute(call('search_workspace', { query: 'needle', pageSize: 5 }));
    expect(result.metadata.resultCount).toBe(5);
    expect(result.metadata.truncated).toBe(true);
    expect(result.metadata.continuationToken).toBeTypeOf('string');
    expect(result.metadata.bytes).toBeLessThan(64 * 1024);
    cleanup(root);
  });
});

describe('tool security and normalization', () => {
  it('rejects traversal, absolute paths, workspace escape, and escaping symlinks', async () => {
    const root = fixture();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'lgs-outside-'));
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'escape.txt'));
    const executor = new ToolExecutor(createRepositoryToolRegistry(), root);
    for (const requested of ['../secret.txt', path.join(outside, 'secret.txt'), 'src/../../secret.txt', 'escape.txt']) {
      const result = await executor.execute(call('read_file', { path: requested }));
      expect(result.status).toBe('error');
      expect(result.error?.code).toBe('invalid_path');
    }
    cleanup(root); cleanup(outside);
  });

  it('rejects malformed calls, unknown fields, mismatched tokens, and invalid ranges', async () => {
    const root = fixture();
    const executor = new ToolExecutor(createRepositoryToolRegistry(), root);
    expect((await executor.execute(null)).error?.code).toBe('invalid_request');
    expect((await executor.execute({ id: 'read_file', arguments: 'src/main.ts' })).error?.code).toBe('invalid_request');
    expect((await executor.execute(call('read_file', { path: 'src/main.ts', surprise: true }))).error?.code).toBe('invalid_request');
    expect((await executor.execute(call('read_file_range', { path: 'src/main.ts', startLine: 5, endLine: 2 }))).error?.code).toBe('invalid_request');
    expect((await executor.execute(call('read_file', { path: 'src/main.ts', continuationToken: Buffer.from('{}').toString('base64url') }))).error?.code).toBe('invalid_request');
    cleanup(root);
  });

  it('bounds oversized implementation output, supports cancellation, and redacts audit secrets', async () => {
    const root = fixture();
    const audit = new MemoryAuditSink();
    const registry = new ToolRegistry().register({
      id: 'test_bounded', description: 'test', permission: READ_ONLY_WORKSPACE_PERMISSION,
      argumentSchema: { type: 'object', properties: { apiKey: { type: 'string' } }, required: ['apiKey'], additionalProperties: false },
      execute: () => ({ data: { content: 'x'.repeat(10_000) }, resultCount: 1 })
    });
    const executor = new ToolExecutor(registry, root, audit, 1024);
    const result = await executor.execute(call('test_bounded', { apiKey: 'do-not-log' }), { sessionId: 'session', model: 'test-model' });
    expect(result.metadata.truncated).toBe(true);
    expect(result.metadata.bytes).toBeLessThanOrEqual(1024);
    expect(audit.entries[0]).toMatchObject({ sessionId: 'session', model: 'test-model', status: 'success' });
    expect(JSON.stringify(audit.entries)).not.toContain('do-not-log');
    expect((await executor.execute(null)).error?.code).toBe('invalid_request');
    expect(audit.entries[1]).toMatchObject({ toolId: 'unknown', status: 'error', errorCode: 'invalid_request' });
    const controller = new AbortController(); controller.abort();
    expect((await executor.execute(call('test_bounded', { apiKey: 'x' }), {}, controller.signal)).status).toBe('cancelled');
    cleanup(root);
  });
});

describe('model tool loop', () => {
  it('validates and executes a model tool request before continuing the model', async () => {
    const root = fixture();
    const observed: string[] = [];
    const model: ToolLoopModel = { next: async messages => {
      observed.push(JSON.stringify(messages));
      return observed.length === 1
        ? { toolCalls: [call('read_file_range', { path: 'src/main.ts', startLine: 1, endLine: 2 })] }
        : { text: 'The entry imports helper.' };
    } };
    const outcome = await runToolLoop({ model, executor: new ToolExecutor(createRepositoryToolRegistry(), root), messages: [textMessage('user', 'What does main import?')] });
    expect(outcome).toMatchObject({ status: 'complete', text: 'The entry imports helper.', turns: 2 });
    expect(outcome.toolResults[0].status).toBe('success');
    expect(observed[1]).toContain('tool_results');
    expect(observed[1]).toContain('helper');
    cleanup(root);
  });
});
