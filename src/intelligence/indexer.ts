import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import * as ts from 'typescript';

export type IndexedFile = {
  path: string; fileType: string; language: string; size: number; mtimeMs: number; hash: string;
  imports: string[]; exports: string[]; symbols: string[]; likelyTest: boolean; likelyDocumentation: boolean;
  directory: string; module: string;
};
export type RepositoryModule = {
  id: string; name: string; path: string; packageManifest?: string;
  directories: string[]; files: string[]; entryPoints: string[];
};
export type RepositoryHierarchy = {
  repository: { path: string; directories: string[]; files: string[]; modules: string[] };
  modules: RepositoryModule[];
};
export type Freshness = {
  index: 'current' | 'stale'; codebaseMap: 'current' | 'stale'; checkedAt: string; staleEntries: string[];
};
export type RepositoryIndex = {
  version: 2; generatedAt: string; root: string; directories: string[]; files: IndexedFile[];
  hierarchy: RepositoryHierarchy; moduleRelationships: { from: string; to: string }[];
  reverseDependencies: Record<string, string[]>; entryPoints: string[]; manifests: string[];
  dependencies: Record<string, string>; gitignore: string[]; freshness: Freshness;
  incremental: { reused: string[]; added: string[]; changed: string[]; removed: string[]; renamed: { from: string; to: string }[] };
};

const HARD_IGNORED = new Set(['.git', 'node_modules', 'dist', 'out', 'build', 'coverage', '.cache', '.turbo', '.lgs']);
const SOURCE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const DOCS = new Set(['.md', '.mdx', '.txt', '.rst']);
const MANIFESTS = new Set(['package.json', 'tsconfig.json', 'jsconfig.json', 'pnpm-lock.yaml', 'yarn.lock', 'package-lock.json']);

export function readGitignore(root: string): string[] {
  const file = path.join(root, '.gitignore');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
}

export function isIgnored(relativePath: string, patterns: string[] = []): boolean {
  if (relativePath.split('/').some(part => HARD_IGNORED.has(part))) return true;
  let ignored = false;
  for (const raw of patterns) {
    const negated = raw.startsWith('!');
    const pattern = negated ? raw.slice(1) : raw;
    if (globMatches(relativePath, pattern)) ignored = !negated;
  }
  return ignored;
}

export function discoverFiles(root: string): string[] {
  const patterns = readGitignore(root);
  const result: string[] = [];
  function visit(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relativePath = relative(root, absolute);
      if (isIgnored(relativePath + (entry.isDirectory() ? '/' : ''), patterns)) continue;
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) result.push(relativePath);
    }
  }
  visit(root);
  return result.sort();
}

export function indexRepository(root: string, previous?: RepositoryIndex): RepositoryIndex {
  const absoluteRoot = path.resolve(root);
  const files = discoverFiles(absoluteRoot);
  const old = new Map((previous?.files ?? []).map(file => [file.path, file]));
  const current: IndexedFile[] = [];
  const added: string[] = [];
  const changed: string[] = [];
  const reused: string[] = [];

  for (const filePath of files) {
    const absolute = path.join(absoluteRoot, filePath);
    const stat = fs.statSync(absolute);
    const hash = fileHash(absolute);
    const prior = old.get(filePath);
    if (prior && prior.hash === hash && prior.directory !== undefined && prior.module !== undefined) {
      current.push({ ...prior, size: stat.size, mtimeMs: stat.mtimeMs });
      reused.push(filePath);
    } else {
      current.push(parseFile(absoluteRoot, filePath, stat, hash));
      (prior ? changed : added).push(filePath);
    }
  }

  const currentSet = new Set(files);
  const removedCandidates = (previous?.files ?? []).map(file => file.path).filter(file => !currentSet.has(file));
  const addedByHash = new Map(current.filter(file => added.includes(file.path)).map(file => [file.hash, file.path]));
  const renamed: { from: string; to: string }[] = [];
  for (const from of removedCandidates) {
    const to = addedByHash.get(old.get(from)?.hash ?? '');
    if (to) renamed.push({ from, to });
  }
  const removed = removedCandidates.filter(file => !renamed.some(rename => rename.from === file));
  const relationships = uniqueRelationships(current.flatMap(file => file.imports.map(request => ({ from: file.path, to: resolveImport(file.path, request, files) }))));
  const reverseDependencies: Record<string, string[]> = {};
  for (const relationship of relationships) {
    reverseDependencies[relationship.to] ??= [];
    reverseDependencies[relationship.to].push(relationship.from);
  }
  for (const dependencies of Object.values(reverseDependencies)) dependencies.sort();
  const manifests = current.filter(file => MANIFESTS.has(path.basename(file.path))).map(file => file.path);
  const hierarchy = buildHierarchy(current, manifests);
  const entryPoints = detectEntryPoints(absoluteRoot, current, manifests);
  for (const module of hierarchy.modules) module.entryPoints = entryPoints.filter(entry => module.files.includes(entry));
  const generatedAt = new Date().toISOString();
  return {
    version: 2, generatedAt, root: absoluteRoot, directories: directoriesOf(files), files: current, hierarchy,
    moduleRelationships: relationships, reverseDependencies, entryPoints, manifests,
    dependencies: readDependencies(absoluteRoot, manifests), gitignore: readGitignore(absoluteRoot),
    freshness: { index: 'current', codebaseMap: 'stale', checkedAt: generatedAt, staleEntries: [] },
    incremental: { reused, added, changed, removed, renamed }
  };
}

export function getFreshness(root: string, index: RepositoryIndex): Freshness {
  const staleEntries = new Set<string>();
  const indexed = new Map(index.files.map(file => [file.path, file]));
  for (const filePath of discoverFiles(root)) {
    const entry = indexed.get(filePath);
    if (!entry || entry.hash !== fileHash(path.join(root, filePath))) staleEntries.add(filePath);
  }
  for (const file of index.files) if (!fs.existsSync(path.join(root, file.path))) staleEntries.add(file.path);
  const stale = staleEntries.size > 0;
  return {
    index: stale ? 'stale' : 'current',
    codebaseMap: stale || index.freshness.codebaseMap !== 'current' ? 'stale' : 'current',
    checkedAt: new Date().toISOString(), staleEntries: [...staleEntries].sort()
  };
}

export function writeRepositoryIndex(root: string, previous?: RepositoryIndex): RepositoryIndex {
  const index = indexRepository(root, previous);
  const output = path.join(root, '.lgs');
  fs.mkdirSync(output, { recursive: true });
  index.freshness = { index: 'current', codebaseMap: 'current', checkedAt: new Date().toISOString(), staleEntries: [] };
  const map = renderCodebaseMap(index);
  fs.writeFileSync(path.join(output, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'CODEBASE_MAP.md'), map);
  return index;
}

export function renderCodebaseMap(index: RepositoryIndex): string {
  const tick = String.fromCharCode(96);
  const lines = [
    '# LGS Codebase Map', '', 'Generated: ' + index.generatedAt, '',
    'This map is generated deterministically from the filesystem, manifests, and source syntax. Source files remain authoritative.', '',
    '## Freshness', '', '- Index: ' + index.freshness.index, '- Codebase Map: ' + index.freshness.codebaseMap,
    '- Stale entries: ' + (index.freshness.staleEntries.join(', ') || 'none'), '',
    '## Repository shape', '', '- Files: ' + index.files.length, '- Directories: ' + index.directories.length,
    '- Modules: ' + index.hierarchy.modules.length, '- Entry points: ' + (index.entryPoints.join(', ') || 'none'),
    '- Manifests: ' + (index.manifests.join(', ') || 'none'), '', '## Modules', ''
  ];
  for (const module of index.hierarchy.modules) {
    lines.push('### ' + module.name);
    lines.push('- Path: ' + (module.path || '.'));
    lines.push('- Files: ' + module.files.length + '; directories: ' + module.directories.length);
    if (module.packageManifest) lines.push('- Manifest: ' + tick + module.packageManifest + tick);
    if (module.entryPoints.length) lines.push('- Entry points: ' + module.entryPoints.map(entry => tick + entry + tick).join(', '));
    for (const filePath of module.files.slice(0, 30)) {
      const file = index.files.find(candidate => candidate.path === filePath);
      if (!file) continue;
      const tags = [file.likelyTest ? 'test' : '', file.likelyDocumentation ? 'documentation' : ''].filter(Boolean).join(', ');
      lines.push('  - ' + tick + file.path + tick + ' — ' + (file.language || file.fileType) + (tags ? ' (' + tags + ')' : ''));
      if (file.symbols.length) lines.push('    - Symbols: ' + file.symbols.slice(0, 12).join(', '));
    }
    lines.push('');
  }
  lines.push('## Relationships', '');
  for (const relation of index.moduleRelationships.slice(0, 120)) lines.push('- ' + tick + relation.from + tick + ' → ' + tick + relation.to + tick);
  if (!index.moduleRelationships.length) lines.push('- No local import relationships detected.');
  lines.push('', '## Reverse dependencies', '');
  for (const [target, sources] of Object.entries(index.reverseDependencies).sort()) lines.push('- ' + tick + target + tick + ' ← ' + sources.map(source => tick + source + tick).join(', '));
  if (!Object.keys(index.reverseDependencies).length) lines.push('- No reverse dependencies detected.');
  lines.push('', '## Dependencies', '');
  for (const [name, version] of Object.entries(index.dependencies).sort()) lines.push('- ' + tick + name + tick + ': ' + version);
  if (!Object.keys(index.dependencies).length) lines.push('- No package dependencies detected.');
  lines.push('', '## Incremental update', '', '- Reused: ' + index.incremental.reused.length, '- Added: ' + index.incremental.added.length, '- Changed: ' + index.incremental.changed.length, '- Removed: ' + index.incremental.removed.length, '- Renamed: ' + index.incremental.renamed.length, '', 'Rebuild with **LGS: Rebuild Repository Index**.');
  return lines.join('\n') + '\n';
}

function parseFile(root: string, filePath: string, stat: fs.Stats, hash: string): IndexedFile {
  const extension = path.extname(filePath).toLowerCase();
  const base: IndexedFile = {
    path: filePath, fileType: extension ? extension.slice(1) : 'unknown', language: languageFor(extension),
    size: stat.size, mtimeMs: stat.mtimeMs, hash, imports: [], exports: [], symbols: [],
    likelyTest: /((^|[._-])(test|spec))|(^|\/)test(s)?\//i.test(filePath),
    likelyDocumentation: DOCS.has(extension) || /readme|changelog|license/i.test(path.basename(filePath)),
    directory: path.posix.dirname(filePath) === '.' ? '' : path.posix.dirname(filePath), module: moduleFor(filePath)
  };
  if (!SOURCE.has(extension)) return base;
  try {
    const source = fs.readFileSync(path.join(root, filePath), 'utf8');
    const kind = extension.includes('tsx') ? ts.ScriptKind.TSX : extension.includes('jsx') ? ts.ScriptKind.JSX : extension.includes('js') ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    const ast = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, kind);
    const imports: string[] = [], exports: string[] = [], symbols: string[] = [];
    for (const statement of ast.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) imports.push(statement.moduleSpecifier.text);
      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) imports.push(statement.moduleSpecifier.text);
      if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) statement.exportClause.elements.forEach(element => exports.push(element.name.text));
      if (ts.isExportAssignment(statement)) exports.push('default');
      const names = declarationNames(statement);
      symbols.push(...names);
      if (names.length && ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) exports.push(...names);
    }
    const requirePattern = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let match: RegExpExecArray | null;
    while ((match = requirePattern.exec(source))) imports.push(match[1]);
    return { ...base, imports: [...new Set(imports)], exports: [...new Set(exports)], symbols: [...new Set(symbols)] };
  } catch { return base; }
}

function buildHierarchy(files: IndexedFile[], manifests: string[]): RepositoryHierarchy {
  const moduleIds = new Set(files.map(file => moduleFor(file.path)));
  const modules: RepositoryModule[] = [...moduleIds].sort().map(id => {
    const moduleFiles = files.filter(file => file.module === id).map(file => file.path).sort();
    const moduleDirectories = directoriesOf(moduleFiles).filter(directory => id === '' || directory === id || directory.startsWith(id + '/'));
    const packageManifest = manifests.find(file => path.basename(file) === 'package.json' && (path.posix.dirname(file) === id || (id === '' && path.posix.dirname(file) === '.'))) ?? manifests.find(file => path.posix.dirname(file) === id || (id === '' && path.posix.dirname(file) === '.'));
    return { id: id || 'root', name: id || 'Repository root', path: id, packageManifest, directories: moduleDirectories, files: moduleFiles, entryPoints: [] };
  });
  const repositoryFiles = files.map(file => file.path).sort();
  return { repository: { path: '', directories: directoriesOf(repositoryFiles), files: repositoryFiles, modules: modules.map(module => module.id) }, modules };
}

function detectEntryPoints(root: string, files: IndexedFile[], manifests: string[]): string[] {
  const result = new Set<string>();
  for (const manifest of manifests.filter(file => path.basename(file) === 'package.json')) {
    try {
      const json = JSON.parse(fs.readFileSync(path.join(root, manifest), 'utf8')) as Record<string, unknown>;
      for (const field of ['main', 'module', 'browser']) if (typeof json[field] === 'string') result.add(path.posix.normalize(path.posix.join(path.posix.dirname(manifest), json[field])));
    } catch { /* Keep malformed manifests observable without stopping indexing. */ }
  }
  for (const file of files.filter(candidate => SOURCE.has(path.extname(candidate.path).toLowerCase()))) {
    try { if (/\bactivate\s*\(/.test(fs.readFileSync(path.join(root, file.path), 'utf8'))) result.add(file.path); }
    catch { /* Metadata remains available when source contents are unreadable. */ }
  }
  return [...result].filter(entry => files.some(file => file.path === entry)).sort();
}

function declarationNames(node: ts.Node): string[] {
  if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node)) && node.name) return [node.name.text];
  if (ts.isVariableStatement(node)) return node.declarationList.declarations.flatMap(declaration => ts.isIdentifier(declaration.name) ? [declaration.name.text] : []);
  return [];
}
function resolveImport(from: string, request: string, files: string[]): string | undefined {
  if (!request.startsWith('.')) return undefined;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), request));
  const extension = path.posix.extname(base);
  const withoutExtension = SOURCE.has(extension) ? base.slice(0, -extension.length) : base;
  const candidates = [base, withoutExtension, ...[...SOURCE].map(value => withoutExtension + value), ...[...SOURCE].map(value => withoutExtension + '/index' + value)];
  return candidates.find(candidate => files.includes(candidate));
}
function readDependencies(root: string, manifests: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const manifest of manifests.filter(file => path.basename(file) === 'package.json')) {
    try {
      const json = JSON.parse(fs.readFileSync(path.join(root, manifest), 'utf8')) as Record<string, unknown>;
      for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        const values = json[section];
        if (typeof values === 'object' && values !== null) for (const [name, version] of Object.entries(values)) if (typeof version === 'string') result[name] = version;
      }
    } catch { /* Ignore malformed manifests. */ }
  }
  return result;
}
function uniqueRelationships(relationships: { from: string; to: string | undefined }[]): { from: string; to: string }[] {
  const seen = new Set<string>();
  return relationships.filter((relationship): relationship is { from: string; to: string } => {
    if (!relationship.to) return false;
    const key = relationship.from + '\0' + relationship.to;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function globMatches(value: string, pattern: string): boolean {
  let normalized = pattern.replace(/^\//, '');
  if (normalized.endsWith('/')) normalized += '**';
  const directoryPrefix = normalized.endsWith('/**') ? normalized.slice(0, -3) : undefined;
  const expression = normalized.split('**').map(part => part.split('*').map(escapeRegExp).join('[^/]*')).join('.*');
  const adjusted = normalized.startsWith('**/') ? '(?:.*/)?' + expression.slice(3) : expression;
  const candidate = value.replace(/\/$/, '');
  return candidate === directoryPrefix || new RegExp('^' + adjusted + '$').test(candidate);
}
function escapeRegExp(value: string): string { return value.replace(/[.+^${}()|[\]\\]/g, '\\$&'); }
function moduleFor(filePath: string): string { const first = filePath.split('/')[0]; return first && !first.includes('.') ? first : ''; }
function fileHash(file: string): string { return createHash('sha1').update(fs.readFileSync(file)).digest('hex'); }
function relative(root: string, file: string): string { return path.relative(root, file).split(path.sep).join('/'); }
function directoriesOf(files: string[]): string[] { return [...new Set(files.flatMap(file => { const parts = file.split('/'); return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/')); }))].sort(); }
function languageFor(extension: string): string { if (['.ts', '.tsx'].includes(extension)) return 'TypeScript'; if (['.js', '.jsx', '.mjs', '.cjs'].includes(extension)) return 'JavaScript'; if (extension === '.json') return 'JSON'; if (DOCS.has(extension)) return 'Markdown/Text'; if (extension === '.css') return 'CSS'; if (extension === '.svg') return 'SVG'; return ''; }
