import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { discoverFiles, getFreshness, indexRepository, isIgnored } from '../src/intelligence/indexer.js';

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lgs-index-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'src', 'b.ts'), 'export const value = 1;');
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'import { value } from "./b.js"; export function run(){ return value; }');
  fs.writeFileSync(path.join(root, 'README.md'), '# Fixture');
  fs.writeFileSync(path.join(root, 'node_modules', 'ignored.js'), 'ignored');
  return root;
}
function cleanup(root: string): void { fs.rmSync(root, { recursive: true, force: true }); }

describe('repository indexer', () => {
  it('discovers files and ignores generated/dependency directories', () => {
    const root = fixture();
    expect(discoverFiles(root)).toEqual(['README.md', 'src/a.ts', 'src/b.ts']);
    expect(isIgnored('node_modules/a.js')).toBe(true);
    expect(isIgnored('src/a.ts')).toBe(false);
    cleanup(root);
  });

  it('respects gitignore patterns and tracks ignored configuration', () => {
    const root = fixture();
    fs.mkdirSync(path.join(root, 'ignored'));
    fs.writeFileSync(path.join(root, '.gitignore'), 'ignored/\n*.tmp\n');
    fs.writeFileSync(path.join(root, 'ignored', 'file.ts'), 'ignored');
    fs.writeFileSync(path.join(root, 'scratch.tmp'), 'ignored');
    expect(discoverFiles(root)).not.toContain('ignored/file.ts');
    expect(discoverFiles(root)).not.toContain('scratch.tmp');
    expect(indexRepository(root).gitignore).toEqual(['ignored/', '*.tmp']);
    cleanup(root);
  });

  it('extracts symbols, imports, exports, reverse relationships, and hierarchy', () => {
    const root = fixture();
    const index = indexRepository(root);
    const file = index.files.find(x => x.path === 'src/a.ts')!;
    expect(file.imports).toContain('./b.js');
    expect(file.exports).toContain('run');
    expect(file.symbols).toContain('run');
    expect(index.files.find(x => x.path === 'README.md')?.likelyDocumentation).toBe(true);
    expect(index.moduleRelationships).toContainEqual({ from: 'src/a.ts', to: 'src/b.ts' });
    expect(index.reverseDependencies['src/b.ts']).toContain('src/a.ts');
    expect(index.hierarchy.modules.some(module => module.name === 'src')).toBe(true);
    expect(index.freshness.index).toBe('current');
    cleanup(root);
  });

  it('indexes each variable declaration as an individual symbol', () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, 'src', 'variables.ts'), 'export const first = 1, second = 2;');
    const file = indexRepository(root).files.find(x => x.path === 'src/variables.ts')!;
    expect(file.symbols).toEqual(['first', 'second']);
    expect(file.exports).toEqual(['first', 'second']);
    cleanup(root);
  });

  it('detects manifest entry points', () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ main: 'src/a.ts' }));
    expect(indexRepository(root).entryPoints).toContain('src/a.ts');
    cleanup(root);
  });

  it('reuses unchanged files and detects changes, additions, removals, and renames', () => {
    const root = fixture();
    const first = indexRepository(root);
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export const changed = true;');
    fs.renameSync(path.join(root, 'src', 'b.ts'), path.join(root, 'src', 'renamed.ts'));
    fs.writeFileSync(path.join(root, 'src', 'new.ts'), 'export const newer = true;');
    const second = indexRepository(root, first);
    expect(second.incremental.reused).toContain('README.md');
    expect(second.incremental.changed).toContain('src/a.ts');
    expect(second.incremental.added).toContain('src/new.ts');
    expect(second.incremental.renamed).toContainEqual({ from: 'src/b.ts', to: 'src/renamed.ts' });
    cleanup(root);
  });

  it('tracks a deleted file and reports stale entries before rebuild', () => {
    const root = fixture();
    const first = indexRepository(root);
    fs.unlinkSync(path.join(root, 'README.md'));
    expect(indexRepository(root, first).incremental.removed).toContain('README.md');
    expect(getFreshness(root, first).index).toBe('stale');
    expect(getFreshness(root, first).staleEntries).toContain('README.md');
    cleanup(root);
  });

  it('does not fail on malformed source', () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, 'src', 'broken.ts'), 'export function {');
    expect(() => indexRepository(root)).not.toThrow();
    expect(indexRepository(root).files.find(x => x.path === 'src/broken.ts')).toBeDefined();
    cleanup(root);
  });
});
