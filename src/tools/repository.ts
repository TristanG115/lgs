import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { createHash } from 'node:crypto';
import { getFreshness, indexRepository, renderCodebaseMap, type IndexedFile, type RepositoryIndex } from '../intelligence/indexer.js';
import { throwIfCancelled, toolError, ToolRegistry } from './framework.js';
import { READ_ONLY_WORKSPACE_PERMISSION, ToolFailure, type JsonSchema, type ToolDefinition, type ToolExecutionContext, type ToolExecutionOutput } from './types.js';

const MAX_READ_LINES = 400;
const DEFAULT_READ_LINES = 200;
const MAX_CONTENT_BYTES = 32 * 1024;
const MAX_SEARCH_RESULTS = 100;
const MAX_INDEX_RESULTS = 200;
const MAX_SEARCH_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOKEN_LENGTH = 2048;

type PathArgs = { path: string } & Record<string, unknown>;
type PageArgs = { pageSize?: number; continuationToken?: string } & Record<string, unknown>;

const pathProperty: JsonSchema = { type: 'string', minLength: 1, maxLength: 1024, description: 'Workspace-relative path.' };
const pageProperties = {
  pageSize: { type: 'integer', minimum: 1, maximum: 200 } as JsonSchema,
  continuationToken: { type: 'string', minLength: 1, maxLength: MAX_TOKEN_LENGTH } as JsonSchema
};

export function createRepositoryToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(listDirectoryTool());
  registry.register(readFileTool());
  registry.register(readFileRangeTool());
  registry.register(searchWorkspaceTool());
  registry.register(findSymbolTool());
  registry.register(findReferencesTool());
  registry.register(fileSummaryTool());
  registry.register(codebaseMapSectionTool());
  registry.register(projectDependenciesTool());
  registry.register(relatedTestsTool());
  registry.register(relatedFilesTool());
  return registry;
}

function definition<TArguments extends Record<string, unknown>, TData>(value: Omit<ToolDefinition<TArguments, TData>, 'permission'>): ToolDefinition<TArguments, TData> {
  return { ...value, permission: READ_ONLY_WORKSPACE_PERMISSION };
}

function listDirectoryTool() {
  type Args = { path?: string; recursive?: boolean; pageSize?: number; continuationToken?: string } & Record<string, unknown>;
  return definition<Args, unknown>({
    id: 'list_directory', description: 'List a workspace directory without reading file contents. Results are sorted and paginated.',
    argumentSchema: { type: 'object', properties: { path: { type: 'string', maxLength: 1024 }, recursive: { type: 'boolean' }, ...pageProperties }, additionalProperties: false },
    async execute(args, context) {
      const relative = normalizeRequestedPath(args.path ?? '.');
      const resolved = safePath(context.workspaceRoot, relative);
      const stat = safeStat(resolved, 'directory');
      if (!stat.isDirectory()) fail('not_file', `${relative} is not a directory.`);
      const index = loadIndex(context.workspaceRoot);
      const prefix = relative === '.' ? '' : relative.replace(/\/$/, '') + '/';
      const entries = indexedDirectoryEntries(index, prefix, args.recursive === true);
      const key = `${relative}\0${args.recursive === true}`;
      const offset = continuationOffset(args.continuationToken, 'list_directory', key);
      return pageOutput('list_directory', key, entries, offset, args.pageSize ?? 100, 'repository-index', { path: relative });
    }
  });
}

function readFileTool() {
  type Args = PathArgs & { maxLines?: number; continuationToken?: string };
  return definition<Args, unknown>({
    id: 'read_file', description: 'Read a bounded page of a UTF-8 text file with line numbers. Large files require continuation.',
    argumentSchema: { type: 'object', properties: { path: pathProperty, maxLines: { type: 'integer', minimum: 1, maximum: MAX_READ_LINES }, continuationToken: pageProperties.continuationToken }, required: ['path'], additionalProperties: false },
    async execute(args, context) {
      const relative = normalizeRequestedPath(args.path);
      const key = relative;
      const startLine = continuationOffset(args.continuationToken, 'read_file', key) + 1;
      return readRange(relative, startLine, startLine + (args.maxLines ?? DEFAULT_READ_LINES) - 1, 'read_file', key, context);
    }
  });
}

function readFileRangeTool() {
  type Args = PathArgs & { startLine: number; endLine: number };
  return definition<Args, unknown>({
    id: 'read_file_range', description: `Read an inclusive line range from a UTF-8 text file (at most ${MAX_READ_LINES} lines).`,
    argumentSchema: { type: 'object', properties: { path: pathProperty, startLine: { type: 'integer', minimum: 1, maximum: 10_000_000 }, endLine: { type: 'integer', minimum: 1, maximum: 10_000_000 } }, required: ['path', 'startLine', 'endLine'], additionalProperties: false },
    validate: args => args.endLine < args.startLine ? ['endLine must be greater than or equal to startLine.'] : args.endLine - args.startLine + 1 > MAX_READ_LINES ? [`A range may contain at most ${MAX_READ_LINES} lines.`] : [],
    execute: (args, context) => readRange(normalizeRequestedPath(args.path), args.startLine, args.endLine, 'read_file_range', normalizeRequestedPath(args.path), context)
  });
}

function searchWorkspaceTool() {
  type Args = { query: string; path?: string; caseSensitive?: boolean; pageSize?: number; continuationToken?: string } & Record<string, unknown>;
  return definition<Args, unknown>({
    id: 'search_workspace', description: 'Search indexed workspace text files for a literal string. Matches include bounded line previews.',
    argumentSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 200 }, path: { type: 'string', maxLength: 1024 }, caseSensitive: { type: 'boolean' }, pageSize: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_RESULTS }, continuationToken: pageProperties.continuationToken }, required: ['query'], additionalProperties: false },
    async execute(args, context) {
      const relative = normalizeRequestedPath(args.path ?? '.');
      safePath(context.workspaceRoot, relative);
      const index = loadIndex(context.workspaceRoot);
      const prefix = relative === '.' ? '' : relative.replace(/\/$/, '') + '/';
      const files = index.files.filter(file => !prefix || file.path === relative || file.path.startsWith(prefix));
      const key = `${args.query}\0${relative}\0${args.caseSensitive === true}`;
      const offset = continuationOffset(args.continuationToken, 'search_workspace', key);
      const wanted = Math.min(args.pageSize ?? 50, MAX_SEARCH_RESULTS);
      const matches: unknown[] = [];
      let seen = 0;
      for (const file of files) {
        throwIfCancelled(context.signal);
        if (file.size > MAX_SEARCH_FILE_BYTES) continue;
        const absolute = safePath(context.workspaceRoot, file.path);
        if (!safeStat(absolute, 'file').isFile() || isBinary(absolute)) continue;
        const lines = fs.readFileSync(absolute, 'utf8').split(/\r?\n/);
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
          const haystack = args.caseSensitive ? lines[lineIndex] : lines[lineIndex].toLocaleLowerCase();
          const needle = args.caseSensitive ? args.query : args.query.toLocaleLowerCase();
          let from = 0;
          while (from <= haystack.length) {
            const column = haystack.indexOf(needle, from);
            if (column < 0) break;
            if (seen++ >= offset) matches.push({ path: file.path, line: lineIndex + 1, column: column + 1, preview: clip(lines[lineIndex], 300) });
            from = column + Math.max(needle.length, 1);
            if (matches.length > wanted) break;
          }
          if (matches.length > wanted) break;
        }
        if (matches.length > wanted) break;
      }
      const hasMore = matches.length > wanted;
      const page = fitItems({ query: args.query, path: relative }, 'matches', matches.slice(0, wanted));
      const more = hasMore || page.length < Math.min(matches.length, wanted);
      return { data: { query: args.query, path: relative, matches: page }, resultCount: page.length, truncated: more, continuationToken: more ? encodeToken('search_workspace', key, offset + page.length) : undefined, source: 'filesystem' };
    }
  });
}

function findSymbolTool() {
  type Args = { symbol: string; exact?: boolean; pageSize?: number; continuationToken?: string } & Record<string, unknown>;
  return definition<Args, unknown>({
    id: 'find_symbol', description: 'Find top-level symbol definitions from Repository Intelligence.',
    argumentSchema: { type: 'object', properties: { symbol: { type: 'string', minLength: 1, maxLength: 200 }, exact: { type: 'boolean' }, ...pageProperties }, required: ['symbol'], additionalProperties: false },
    execute(args, context) {
      const index = loadIndex(context.workspaceRoot);
      const query = args.exact === false ? args.symbol.toLocaleLowerCase() : args.symbol;
      const results = index.files.flatMap(file => file.symbols.flatMap(symbol => {
        const matched = args.exact === false ? symbol.toLocaleLowerCase().includes(query) : symbol === query;
        return matched ? [{ path: file.path, symbol, language: file.language, exported: file.exports.includes(symbol), reason: `Repository index declares ${symbol} in this file.` }] : [];
      }));
      const key = `${args.symbol}\0${args.exact !== false}`;
      return pageOutput('find_symbol', key, results, continuationOffset(args.continuationToken, 'find_symbol', key), args.pageSize ?? 50, 'repository-index', { symbol: args.symbol });
    }
  });
}

function findReferencesTool() {
  type Args = { symbol: string; path?: string; pageSize?: number; continuationToken?: string } & Record<string, unknown>;
  return definition<Args, unknown>({
    id: 'find_references', description: 'Find bounded identifier references in indexed source files.',
    argumentSchema: { type: 'object', properties: { symbol: { type: 'string', minLength: 1, maxLength: 200, pattern: '^[A-Za-z_$][A-Za-z0-9_$]*$' }, path: { type: 'string', maxLength: 1024 }, pageSize: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_RESULTS }, continuationToken: pageProperties.continuationToken }, required: ['symbol'], additionalProperties: false },
    execute(args, context) {
      const relative = normalizeRequestedPath(args.path ?? '.');
      const index = loadIndex(context.workspaceRoot);
      const prefix = relative === '.' ? '' : relative.replace(/\/$/, '') + '/';
      const expression = new RegExp(`\\b${escapeRegExp(args.symbol)}\\b`, 'g');
      const results: unknown[] = [];
      for (const file of index.files.filter(candidate => candidate.language === 'TypeScript' || candidate.language === 'JavaScript')) {
        throwIfCancelled(context.signal);
        if (prefix && file.path !== relative && !file.path.startsWith(prefix) || file.size > MAX_SEARCH_FILE_BYTES) continue;
        const absolute = safePath(context.workspaceRoot, file.path);
        const lines = fs.readFileSync(absolute, 'utf8').split(/\r?\n/);
        lines.forEach((line, lineIndex) => {
          expression.lastIndex = 0;
          let match: RegExpExecArray | null;
          while ((match = expression.exec(line))) results.push({ path: file.path, line: lineIndex + 1, column: match.index + 1, preview: clip(line, 300) });
        });
      }
      const key = `${args.symbol}\0${relative}`;
      return pageOutput('find_references', key, results, continuationOffset(args.continuationToken, 'find_references', key), Math.min(args.pageSize ?? 50, MAX_SEARCH_RESULTS), 'filesystem', { symbol: args.symbol });
    }
  });
}

function fileSummaryTool() {
  return definition<PathArgs, unknown>({
    id: 'get_file_summary', description: 'Return compact indexed metadata, symbols, imports, exports, and repository relationships for a file.',
    argumentSchema: { type: 'object', properties: { path: pathProperty }, required: ['path'], additionalProperties: false },
    execute(args, context) {
      const relative = normalizeRequestedPath(args.path);
      safeStat(safePath(context.workspaceRoot, relative), 'file');
      const index = loadIndex(context.workspaceRoot);
      const file = indexedFile(index, relative);
      const importedBy = index.reverseDependencies[relative] ?? [];
      const importsLocal = index.moduleRelationships.filter(edge => edge.from === relative).map(edge => edge.to);
      const compact = { ...file, imports: file.imports.slice(0, 100), exports: file.exports.slice(0, 100), symbols: file.symbols.slice(0, 100), importedBy: importedBy.slice(0, 100), importsLocal: importsLocal.slice(0, 100), entryPoint: index.entryPoints.includes(relative), totals: { imports: file.imports.length, exports: file.exports.length, symbols: file.symbols.length, importedBy: importedBy.length, importsLocal: importsLocal.length } };
      const truncated = file.imports.length > 100 || file.exports.length > 100 || file.symbols.length > 100 || importedBy.length > 100 || importsLocal.length > 100;
      return { data: compact, resultCount: 1, truncated, source: 'repository-index' };
    }
  });
}

function codebaseMapSectionTool() {
  type Args = { section: string; maxLines?: number; continuationToken?: string } & Record<string, unknown>;
  return definition<Args, unknown>({
    id: 'get_codebase_map_section', description: 'Read one named section from the generated deterministic Codebase Map.',
    argumentSchema: { type: 'object', properties: { section: { type: 'string', minLength: 1, maxLength: 100 }, maxLines: { type: 'integer', minimum: 1, maximum: MAX_READ_LINES }, continuationToken: pageProperties.continuationToken }, required: ['section'], additionalProperties: false },
    execute(args, context) {
      const index = loadIndex(context.workspaceRoot);
      const mapFile = path.join(context.workspaceRoot, '.lgs', 'CODEBASE_MAP.md');
      const useMap = index.freshness.codebaseMap === 'current' && fs.existsSync(mapFile);
      const markdown = useMap ? fs.readFileSync(safePath(context.workspaceRoot, '.lgs/CODEBASE_MAP.md'), 'utf8') : renderCodebaseMap(index);
      const section = extractMapSection(markdown, args.section);
      if (!section) fail('not_found', `Codebase Map section not found: ${args.section}`);
      const lines = section.split(/\r?\n/);
      const key = args.section.toLocaleLowerCase();
      const offset = continuationOffset(args.continuationToken, 'get_codebase_map_section', key);
      const count = args.maxLines ?? 200;
      const selected = lines.slice(offset, offset + count);
      const hasMore = offset + count < lines.length;
      return { data: { section: args.section, startLine: offset + 1, endLine: offset + selected.length, content: selected.join('\n') }, resultCount: selected.length, truncated: hasMore, continuationToken: hasMore ? encodeToken('get_codebase_map_section', key, offset + count) : undefined, source: useMap ? 'codebase-map' : 'repository-index' };
    }
  });
}

function projectDependenciesTool() {
  type Args = PageArgs;
  return definition<Args, unknown>({
    id: 'get_project_dependencies', description: 'Return manifest dependencies from Repository Intelligence in bounded pages.',
    argumentSchema: { type: 'object', properties: pageProperties, additionalProperties: false },
    execute(args, context) {
      const entries = Object.entries(loadIndex(context.workspaceRoot).dependencies).sort(([a], [b]) => a.localeCompare(b)).map(([name, version]) => ({ name, version }));
      return pageOutput('get_project_dependencies', 'all', entries, continuationOffset(args.continuationToken, 'get_project_dependencies', 'all'), args.pageSize ?? 100, 'repository-index', {});
    }
  });
}

function relatedTestsTool() {
  type Args = PathArgs & PageArgs;
  return definition<Args, unknown>({
    id: 'get_related_tests', description: 'Find likely tests using indexed imports, reverse dependencies, and filename affinity.',
    argumentSchema: { type: 'object', properties: { path: pathProperty, ...pageProperties }, required: ['path'], additionalProperties: false },
    execute(args, context) {
      const relative = normalizeRequestedPath(args.path);
      const index = loadIndex(context.workspaceRoot);
      indexedFile(index, relative);
      const stem = path.posix.basename(relative).replace(/\.[^.]+$/, '').toLocaleLowerCase();
      const importers = new Set(index.reverseDependencies[relative] ?? []);
      const results = index.files.filter(file => file.likelyTest).flatMap(file => {
        const direct = importers.has(file.path);
        const affinity = file.path.toLocaleLowerCase().includes(stem);
        if (!direct && !affinity) return [];
        return [{ path: file.path, reason: direct ? `Test imports ${relative}.` : `Test filename is related to ${path.posix.basename(relative)}.` }];
      });
      const key = relative;
      return pageOutput('get_related_tests', key, results, continuationOffset(args.continuationToken, 'get_related_tests', key), args.pageSize ?? 50, 'repository-index', { path: relative });
    }
  });
}

function relatedFilesTool() {
  type Args = PathArgs & PageArgs;
  return definition<Args, unknown>({
    id: 'get_related_files', description: 'Find files directly imported by or importing a target file, with relevance reasons.',
    argumentSchema: { type: 'object', properties: { path: pathProperty, ...pageProperties }, required: ['path'], additionalProperties: false },
    execute(args, context) {
      const relative = normalizeRequestedPath(args.path);
      const index = loadIndex(context.workspaceRoot);
      indexedFile(index, relative);
      const reasons = new Map<string, string[]>();
      for (const edge of index.moduleRelationships) {
        if (edge.from === relative) addReason(reasons, edge.to, `${relative} imports this file.`);
        if (edge.to === relative) addReason(reasons, edge.from, `This file imports ${relative}.`);
      }
      const results = [...reasons].sort(([a], [b]) => a.localeCompare(b)).map(([filePath, reason]) => ({ path: filePath, reason: reason.join(' ') }));
      const key = relative;
      return pageOutput('get_related_files', key, results, continuationOffset(args.continuationToken, 'get_related_files', key), args.pageSize ?? 50, 'repository-index', { path: relative });
    }
  });
}

async function readRange(relative: string, startLine: number, endLine: number, toolId: string, key: string, context: ToolExecutionContext): Promise<ToolExecutionOutput<unknown>> {
  const absolute = safePath(context.workspaceRoot, relative);
  const stat = safeStat(absolute, 'file');
  if (!stat.isFile()) fail('not_file', `${relative} is not a file.`);
  if (isBinary(absolute)) fail('binary_file', `${relative} appears to be binary.`);
  const stream = fs.createReadStream(absolute, { encoding: 'utf8' });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const selected: string[] = [];
  let lineNumber = 0;
  let byteCount = 0;
  let hasAdditionalLines = false;
  let contentTruncated = false;
  try {
    for await (const line of reader) {
      throwIfCancelled(context.signal);
      lineNumber++;
      if (lineNumber < startLine) continue;
      if (lineNumber > endLine) { hasAdditionalLines = true; break; }
      const formatted = `${lineNumber}: ${line}`;
      const bytes = Buffer.byteLength(formatted + '\n');
      if (byteCount + bytes > MAX_CONTENT_BYTES) {
        contentTruncated = true;
        if (!selected.length) selected.push(clipBytes(formatted, MAX_CONTENT_BYTES - 24) + ' … [line truncated]');
        break;
      }
      selected.push(formatted); byteCount += bytes;
    }
  } finally { reader.close(); stream.destroy(); }
  const lastLine = selected.length ? startLine + selected.length - 1 : startLine - 1;
  const paginated = toolId === 'read_file' && (hasAdditionalLines || contentTruncated);
  const token = paginated ? encodeToken(toolId, key, Math.max(lastLine, startLine)) : undefined;
  const hash = createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
  return { data: { path: relative, startLine, endLine: lastLine, content: selected.join('\n'), fileBytes: stat.size, hash }, resultCount: selected.length, truncated: paginated || contentTruncated, continuationToken: token, source: 'filesystem' };
}

function safePath(root: string, requested: string): string {
  if (requested.includes('\0') || path.isAbsolute(requested) || path.win32.isAbsolute(requested)) fail('invalid_path', 'Paths must be workspace-relative.');
  const portable = requested.replace(/\\/g, '/');
  if (portable.split('/').includes('..')) fail('invalid_path', 'Parent-directory traversal is not allowed.');
  const rootAbsolute = path.resolve(root);
  let rootReal: string;
  try { rootReal = fs.realpathSync(rootAbsolute); } catch { fail('not_found', 'Workspace root does not exist.'); }
  const candidate = path.resolve(rootReal, portable === '.' ? '' : portable);
  if (!within(rootReal, candidate)) fail('invalid_path', 'Path escapes the workspace.');
  if (!fs.existsSync(candidate)) fail('not_found', `Workspace path not found: ${requested}`);
  let real: string;
  try { real = fs.realpathSync(candidate); } catch { fail('not_found', `Workspace path not found: ${requested}`); }
  if (!within(rootReal, real)) fail('invalid_path', 'Symlink target escapes the workspace.');
  return real;
}

function within(root: string, candidate: string): boolean { const relative = path.relative(root, candidate); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); }
function normalizeRequestedPath(value: string): string {
  if (value === '' || value === '.') return '.';
  const portable = value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (!portable) return '.';
  return portable;
}
function safeStat(absolute: string, label: string): fs.Stats {
  try { return fs.statSync(absolute); } catch { fail('not_found', `Requested ${label} was not found.`); }
}
function isBinary(file: string): boolean {
  const descriptor = fs.openSync(file, 'r');
  try { const buffer = Buffer.alloc(4096); const read = fs.readSync(descriptor, buffer, 0, buffer.length, 0); return buffer.subarray(0, read).includes(0); }
  finally { fs.closeSync(descriptor); }
}

function loadIndex(root: string): RepositoryIndex {
  try {
    const file = safePath(root, '.lgs/index.json');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as RepositoryIndex;
    if (parsed.version === 2 && fs.realpathSync(parsed.root) === fs.realpathSync(root) && Array.isArray(parsed.files)) {
      const freshness = getFreshness(root, parsed);
      return freshness.index === 'current' ? { ...parsed, freshness } : indexRepository(root, parsed);
    }
  } catch { /* Build an in-memory index when generated intelligence is absent or invalid. */ }
  return indexRepository(root);
}
function indexedFile(index: RepositoryIndex, relative: string): IndexedFile {
  const file = index.files.find(candidate => candidate.path === relative);
  if (!file) fail('not_found', `File is not present in Repository Intelligence: ${relative}`);
  return file;
}
function indexedDirectoryEntries(index: RepositoryIndex, prefix: string, recursive: boolean): unknown[] {
  const paths = new Map<string, { path: string; name: string; type: 'directory' | 'file'; size?: number }>();
  for (const directory of index.directories) {
    if (!directory.startsWith(prefix) || directory === prefix.replace(/\/$/, '')) continue;
    const remainder = directory.slice(prefix.length);
    if (!recursive && remainder.includes('/')) continue;
    paths.set(directory, { path: directory, name: path.posix.basename(directory), type: 'directory' });
  }
  for (const file of index.files) {
    if (!file.path.startsWith(prefix)) continue;
    const remainder = file.path.slice(prefix.length);
    if (!recursive && remainder.includes('/')) continue;
    paths.set(file.path, { path: file.path, name: path.posix.basename(file.path), type: 'file', size: file.size });
  }
  return [...paths.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function pageOutput(tool: string, key: string, values: unknown[], offset: number, pageSize: number, source: 'repository-index' | 'filesystem', extra: Record<string, unknown>): ToolExecutionOutput<unknown> {
  const size = Math.min(pageSize, MAX_INDEX_RESULTS);
  const page = fitItems({ ...extra, offset, total: values.length }, 'items', values.slice(offset, offset + size));
  const hasMore = offset + page.length < values.length;
  return { data: { ...extra, items: page, offset, total: values.length }, resultCount: page.length, truncated: hasMore, continuationToken: hasMore ? encodeToken(tool, key, offset + page.length) : undefined, source };
}
function fitItems(base: Record<string, unknown>, field: string, values: unknown[]): unknown[] {
  const result = [...values];
  while (result.length > 1 && Buffer.byteLength(JSON.stringify({ ...base, [field]: result })) > MAX_CONTENT_BYTES) result.pop();
  return result;
}
function encodeToken(tool: string, key: string, offset: number): string { return Buffer.from(JSON.stringify({ v: 1, tool, key, offset })).toString('base64url'); }
function continuationOffset(token: string | undefined, tool: string, key: string): number {
  if (!token) return 0;
  try {
    const value = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (value.v !== 1 || value.tool !== tool || value.key !== key || !Number.isSafeInteger(value.offset) || (value.offset as number) < 0 || (value.offset as number) > 1_000_000) throw new Error();
    return value.offset as number;
  } catch { fail('invalid_request', 'Invalid or mismatched continuation token.'); }
}
function extractMapSection(markdown: string, requested: string): string | undefined {
  const lines = markdown.split(/\r?\n/);
  const query = requested.trim().replace(/^#+\s*/, '').toLocaleLowerCase();
  const start = lines.findIndex(line => /^##\s+/.test(line) && line.replace(/^##\s+/, '').trim().toLocaleLowerCase() === query);
  if (start < 0) return undefined;
  let end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
  if (end < 0) end = lines.length;
  return lines.slice(start, end).join('\n').trimEnd();
}
function addReason(map: Map<string, string[]>, file: string, reason: string): void { const values = map.get(file) ?? []; values.push(reason); map.set(file, values); }
function clip(value: string, maximum: number): string { return value.length <= maximum ? value : value.slice(0, maximum - 1) + '…'; }
function clipBytes(value: string, maximum: number): string {
  const buffer = Buffer.from(value);
  return buffer.length <= maximum ? value : buffer.subarray(0, maximum).toString('utf8');
}
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function fail(code: Parameters<typeof toolError>[0], message: string): never { throw new ToolFailure(toolError(code, message)); }
