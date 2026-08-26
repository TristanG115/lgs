import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { throwIfCancelled, toolError, ToolRegistry } from './framework.js';
import { READ_ONLY_WORKSPACE_PERMISSION, ToolFailure, type JsonSchema, type ToolDefinition, type ToolExecutionContext, type ToolExecutionOutput } from './types.js';

const GIT_COMMANDS = new Set(['status', 'diff', 'log', 'show', 'blame', 'rev-parse', 'symbolic-ref', 'ls-files']);
const MAX_GIT_BUFFER = 4 * 1024 * 1024;
const MAX_DIFF_LINES = 400;
const MAX_HISTORY_PAGE = 50;
const DEFAULT_HISTORY_PAGE = 10;
const MAX_BLAME_LINES = 200;
const MAX_TOKEN_LENGTH = 2048;

export type GitChange = {
  path: string;
  status: string;
  originalPath?: string;
  fingerprint?: string;
};

export type GitBaseline = {
  version: 1;
  capturedAt: string;
  workspaceRoot: string;
  repositoryRoot: string | null;
  repository: boolean;
  branch: string | null;
  detached: boolean;
  head: string | null;
  staged: GitChange[];
  unstaged: GitChange[];
  untracked: GitChange[];
};

export type GitCommandResult = { stdout: string; stderr: string };
export type GitCommandRunner = (cwd: string, arguments_: readonly string[], signal: AbortSignal, maxBuffer: number) => Promise<GitCommandResult>;

export class GitCommandError extends Error {
  constructor(message: string, readonly exitCode?: number, readonly stderr = '') { super(message); this.name = 'GitCommandError'; }
}

export class GitClient {
  constructor(readonly workspaceRoot: string, private readonly runner: GitCommandRunner = runGitCommand) {}

  async run(command: string, arguments_: readonly string[], signal: AbortSignal, maxBuffer = MAX_GIT_BUFFER): Promise<GitCommandResult> {
    if (!GIT_COMMANDS.has(command)) throw new Error(`Git command is not read-only or supported: ${command}`);
    throwIfCancelled(signal);
    return this.runner(this.workspaceRoot, [command, ...arguments_], signal, maxBuffer);
  }

  async tryRun(command: string, arguments_: readonly string[], signal: AbortSignal): Promise<GitCommandResult | undefined> {
    try { return await this.run(command, arguments_, signal); }
    catch (error) { if (signal.aborted) throw error; return undefined; }
  }

  async isRepository(signal: AbortSignal): Promise<boolean> {
    const result = await this.tryRun('rev-parse', ['--is-inside-work-tree'], signal);
    return result?.stdout.trim() === 'true';
  }
}

export function runGitCommand(cwd: string, arguments_: readonly string[], signal: AbortSignal, maxBuffer: number): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    execFile('git', ['--no-pager', '-C', cwd, ...arguments_], {
      encoding: 'utf8', maxBuffer, windowsHide: true, signal,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }
    }, (error, stdout, stderr) => {
      if (error) {
        const exitCode = typeof error.code === 'number' ? error.code : undefined;
        reject(new GitCommandError(signal.aborted ? 'Git operation cancelled.' : stderr.trim() || error.message, exitCode, stderr));
      } else resolve({ stdout, stderr });
    });
  });
}

export async function captureGitBaseline(workspaceRoot: string, signal: AbortSignal = new AbortController().signal, runner?: GitCommandRunner): Promise<GitBaseline> {
  const root = fs.realpathSync(workspaceRoot);
  const client = new GitClient(root, runner);
  if (!await client.isRepository(signal)) return emptyBaseline(root);
  const repositoryRootResult = await client.run('rev-parse', ['--show-toplevel'], signal);
  const repositoryRoot = fs.realpathSync(repositoryRootResult.stdout.trim());
  const workspacePrefix = path.relative(repositoryRoot, root).split(path.sep).join('/');
  const branchResult = await client.tryRun('symbolic-ref', ['--quiet', '--short', 'HEAD'], signal);
  const headResult = await client.tryRun('rev-parse', ['--verify', 'HEAD'], signal);
  const changes = await readChanges(client, workspacePrefix, signal);
  await fingerprintChanges(client, root, changes.staged, 'staged', signal);
  await fingerprintChanges(client, root, changes.unstaged, 'unstaged', signal);
  await fingerprintChanges(client, root, changes.untracked, 'untracked', signal);
  const branch = branchResult?.stdout.trim() || null;
  return {
    version: 1, capturedAt: new Date().toISOString(), workspaceRoot: root, repositoryRoot, repository: true,
    branch, detached: branch === null && Boolean(headResult?.stdout.trim()), head: headResult?.stdout.trim() || null,
    ...changes
  };
}

export class GitBaselineStore {
  private readonly baselines = new Map<string, GitBaseline>();
  constructor(initial: Record<string, GitBaseline> = {}) {
    for (const [taskId, baseline] of Object.entries(initial)) if (baseline?.version === 1) this.baselines.set(taskId, baseline);
  }
  get(taskId: string): GitBaseline | undefined { return this.baselines.get(taskId); }
  async ensure(taskId: string, workspaceRoot: string, signal?: AbortSignal): Promise<GitBaseline> {
    const existing = this.baselines.get(taskId);
    const root = fs.realpathSync(workspaceRoot);
    if (existing && existing.workspaceRoot === root) return existing;
    const baseline = await captureGitBaseline(root, signal);
    this.baselines.set(taskId, baseline);
    return baseline;
  }
  serialize(): Record<string, GitBaseline> { return Object.fromEntries(this.baselines); }
}

export function createGitToolRegistry(options: { baseline?: GitBaseline; runner?: GitCommandRunner } = {}): ToolRegistry {
  return registerGitTools(new ToolRegistry(), options);
}

export function registerGitTools(registry: ToolRegistry, options: { baseline?: GitBaseline; runner?: GitCommandRunner } = {}): ToolRegistry {
  registry.register(gitStatusTool(options));
  registry.register(gitDiffTool(options));
  registry.register(gitFileHistoryTool(options));
  registry.register(gitShowCommitTool(options));
  registry.register(gitBlameRangeTool(options));
  registry.register(gitLogSearchTool(options));
  return registry;
}

function definition<TArguments extends Record<string, unknown>, TData>(value: Omit<ToolDefinition<TArguments, TData>, 'permission'>): ToolDefinition<TArguments, TData> {
  return { ...value, permission: READ_ONLY_WORKSPACE_PERMISSION };
}

function gitStatusTool(options: { baseline?: GitBaseline; runner?: GitCommandRunner }) {
  return definition<Record<string, never>, unknown>({
    id: 'git_status', description: 'Return compact current Git state and compare it with the state captured before this LGS task.',
    argumentSchema: { type: 'object', properties: {}, additionalProperties: false },
    async execute(_args, context) {
      const current = await captureGitBaseline(context.workspaceRoot, context.signal, options.runner);
      if (!current.repository) return { data: { repository: false, message: 'Workspace is not in a Git repository.' }, resultCount: 0, source: 'git' };
      const baseline = matchingBaseline(options.baseline, current.workspaceRoot);
      return { data: { repository: true, current: publicBaseline(current), baseline: baseline ? publicBaseline(baseline) : undefined, comparison: baseline ? compareStates(baseline, current) : undefined }, resultCount: current.staged.length + current.unstaged.length + current.untracked.length, source: 'git' };
    }
  });
}

function gitDiffTool(options: { runner?: GitCommandRunner }) {
  type Args = { scope?: 'unstaged' | 'staged' | 'commit'; path?: string; commit?: string; contextLines?: number; maxLines?: number; continuationToken?: string } & Record<string, unknown>;
  return definition<Args, unknown>({
    id: 'git_diff', description: 'Read a bounded staged, unstaged, or single-commit diff. Use continuation tokens for additional lines.',
    argumentSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['unstaged', 'staged', 'commit'] }, path: gitPathSchema(), commit: commitSchema(), contextLines: { type: 'integer', minimum: 0, maximum: 20 }, maxLines: { type: 'integer', minimum: 1, maximum: MAX_DIFF_LINES }, continuationToken: tokenSchema() }, additionalProperties: false },
    validate: args => args.scope === 'commit' && !args.commit ? ['commit is required when scope is commit.'] : args.scope !== 'commit' && args.commit ? ['commit is only valid when scope is commit.'] : [],
    async execute(args, context) {
      const client = await requireRepository(context, options.runner);
      const scope = args.scope ?? 'unstaged';
      const relative = args.path ? safeGitPath(context.workspaceRoot, args.path) : '.';
      const common = ['--no-ext-diff', '--no-textconv', '--no-color', '--relative', `--unified=${args.contextLines ?? 3}`];
      const commandArgs = scope === 'staged' ? [...common, '--cached', '--', relative]
        : scope === 'commit' ? [...common, `${args.commit as string}^!`, '--', relative]
        : [...common, '--', relative];
      const output = await client.run('diff', commandArgs, context.signal);
      const key = `${scope}\0${args.commit ?? ''}\0${relative}\0${args.contextLines ?? 3}`;
      return linePage('git_diff', key, output.stdout, continuationOffset(args.continuationToken, 'git_diff', key), args.maxLines ?? 200, { scope, path: relative, commit: args.commit });
    }
  });
}

function gitFileHistoryTool(options: { runner?: GitCommandRunner }) {
  type Args = { path: string; pageSize?: number; continuationToken?: string } & Record<string, unknown>;
  return definition<Args, unknown>({
    id: 'git_file_history', description: 'Return compact recent commits for one file; request older pages explicitly with the continuation token.',
    argumentSchema: { type: 'object', properties: { path: gitPathSchema(), pageSize: { type: 'integer', minimum: 1, maximum: MAX_HISTORY_PAGE }, continuationToken: tokenSchema() }, required: ['path'], additionalProperties: false },
    async execute(args, context) {
      const client = await requireRepository(context, options.runner);
      const relative = safeGitPath(context.workspaceRoot, args.path);
      const key = relative;
      const offset = continuationOffset(args.continuationToken, 'git_file_history', key);
      const pageSize = args.pageSize ?? DEFAULT_HISTORY_PAGE;
      const result = await client.run('log', ['--follow', `--max-count=${pageSize + 1}`, `--skip=${offset}`, '--format=%H%x1f%aI%x1f%s%x1e', '--', relative], context.signal);
      const commits = parseLog(result.stdout);
      const hasMore = commits.length > pageSize;
      const page = commits.slice(0, pageSize);
      return { data: { path: relative, commits: page, offset }, resultCount: page.length, truncated: hasMore, continuationToken: hasMore ? encodeToken('git_file_history', key, offset + page.length) : undefined, source: 'git' };
    }
  });
}

function gitShowCommitTool(options: { runner?: GitCommandRunner }) {
  type Args = { commit: string; includeDiff?: boolean; pageSize?: number; maxLines?: number; continuationToken?: string } & Record<string, unknown>;
  return definition<Args, unknown>({
    id: 'git_show_commit', description: 'Show compact commit metadata and changed files. Set includeDiff to explicitly request the bounded full patch.',
    argumentSchema: { type: 'object', properties: { commit: commitSchema(), includeDiff: { type: 'boolean' }, pageSize: { type: 'integer', minimum: 1, maximum: 200 }, maxLines: { type: 'integer', minimum: 1, maximum: MAX_DIFF_LINES }, continuationToken: tokenSchema() }, required: ['commit'], additionalProperties: false },
    async execute(args, context) {
      const client = await requireRepository(context, options.runner);
      const metadataResult = await client.run('show', ['--quiet', '--format=%H%x1f%aI%x1f%an%x1f%s%x1f%b', args.commit], context.signal);
      const metadata = parseCommit(metadataResult.stdout);
      if (!metadata) fail('not_found', `Commit not found: ${args.commit}`);
      const mode = args.includeDiff ? 'diff' : 'files';
      const key = `${args.commit}\0${mode}`;
      const offset = continuationOffset(args.continuationToken, 'git_show_commit', key);
      if (args.includeDiff) {
        const patch = await client.run('show', ['--format=', '--patch', '--no-ext-diff', '--no-textconv', '--no-color', '--relative', args.commit, '--', '.'], context.signal);
        return linePage('git_show_commit', key, patch.stdout, offset, args.maxLines ?? 200, { commit: metadata, includeDiff: true });
      }
      const filesResult = await client.run('show', ['--format=', '--name-only', '-z', '--no-renames', '--relative', args.commit, '--', '.'], context.signal);
      const files = filesResult.stdout.split('\0').filter(Boolean);
      const pageSize = args.pageSize ?? 100;
      const page = files.slice(offset, offset + pageSize);
      const hasMore = offset + page.length < files.length;
      return { data: { commit: metadata, includeDiff: false, files: page, offset, total: files.length }, resultCount: page.length, truncated: hasMore, continuationToken: hasMore ? encodeToken('git_show_commit', key, offset + page.length) : undefined, source: 'git' };
    }
  });
}

function gitBlameRangeTool(options: { runner?: GitCommandRunner }) {
  type Args = { path: string; startLine: number; endLine: number } & Record<string, unknown>;
  return definition<Args, unknown>({
    id: 'git_blame_range', description: 'Return compact commit attribution for an explicit file line range.',
    argumentSchema: { type: 'object', properties: { path: gitPathSchema(), startLine: { type: 'integer', minimum: 1, maximum: 10_000_000 }, endLine: { type: 'integer', minimum: 1, maximum: 10_000_000 } }, required: ['path', 'startLine', 'endLine'], additionalProperties: false },
    validate: args => args.endLine < args.startLine ? ['endLine must be greater than or equal to startLine.'] : args.endLine - args.startLine + 1 > MAX_BLAME_LINES ? [`A blame range may contain at most ${MAX_BLAME_LINES} lines.`] : [],
    async execute(args, context) {
      const client = await requireRepository(context, options.runner);
      const relative = safeGitPath(context.workspaceRoot, args.path);
      const result = await client.run('blame', ['--line-porcelain', `-L${args.startLine},${args.endLine}`, '--', relative], context.signal);
      const ranges = parseBlame(result.stdout);
      return { data: { path: relative, startLine: args.startLine, endLine: args.endLine, ranges }, resultCount: ranges.length, source: 'git' };
    }
  });
}

function gitLogSearchTool(options: { runner?: GitCommandRunner }) {
  type Args = { query: string; path?: string; pageSize?: number; continuationToken?: string } & Record<string, unknown>;
  return definition<Args, unknown>({
    id: 'git_log_search', description: 'Search commit messages and return compact matching commit, date, and summary records.',
    argumentSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 200 }, path: gitPathSchema(), pageSize: { type: 'integer', minimum: 1, maximum: MAX_HISTORY_PAGE }, continuationToken: tokenSchema() }, required: ['query'], additionalProperties: false },
    async execute(args, context) {
      const client = await requireRepository(context, options.runner);
      const relative = args.path ? safeGitPath(context.workspaceRoot, args.path) : undefined;
      const key = `${args.query}\0${relative ?? ''}`;
      const offset = continuationOffset(args.continuationToken, 'git_log_search', key);
      const pageSize = args.pageSize ?? DEFAULT_HISTORY_PAGE;
      const commandArgs = ['--all', '--fixed-strings', `--grep=${args.query}`, `--max-count=${pageSize + 1}`, `--skip=${offset}`, '--format=%H%x1f%aI%x1f%s%x1e'];
      commandArgs.push('--', relative ?? '.');
      const result = await client.run('log', commandArgs, context.signal);
      const commits = parseLog(result.stdout);
      const hasMore = commits.length > pageSize;
      const page = commits.slice(0, pageSize);
      return { data: { query: args.query, path: relative, commits: page, offset }, resultCount: page.length, truncated: hasMore, continuationToken: hasMore ? encodeToken('git_log_search', key, offset + page.length) : undefined, source: 'git' };
    }
  });
}

async function requireRepository(context: ToolExecutionContext, runner?: GitCommandRunner): Promise<GitClient> {
  const client = new GitClient(context.workspaceRoot, runner);
  if (!await client.isRepository(context.signal)) fail('unsupported', 'Workspace is not in a Git repository.');
  return client;
}

async function readChanges(client: GitClient, workspacePrefix: string, signal: AbortSignal): Promise<Pick<GitBaseline, 'staged' | 'unstaged' | 'untracked'>> {
  const result = await client.run('status', ['--porcelain=v1', '-z', '--untracked-files=all', '--', '.'], signal);
  const staged: GitChange[] = [], unstaged: GitChange[] = [], untracked: GitChange[] = [];
  const records = result.stdout.split('\0');
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (!record || record.length < 4) continue;
    const x = record[0], y = record[1], filePath = workspaceStatusPath(record.slice(3), workspacePrefix);
    if (filePath === undefined) continue;
    if (x === '?' && y === '?') { untracked.push({ path: filePath, status: 'untracked' }); continue; }
    const renamed = x === 'R' || x === 'C' || y === 'R' || y === 'C';
    const originalRaw = renamed ? records[++index] || undefined : undefined;
    const originalPath = originalRaw ? workspaceStatusPath(originalRaw, workspacePrefix) : undefined;
    if (x !== ' ' && x !== '?') staged.push({ path: filePath, status: x, originalPath });
    if (y !== ' ' && y !== '?') unstaged.push({ path: filePath, status: y, originalPath });
  }
  return { staged, unstaged, untracked };
}

async function fingerprintChanges(client: GitClient, root: string, changes: GitChange[], kind: 'staged' | 'unstaged' | 'untracked', signal: AbortSignal): Promise<void> {
  for (const change of changes) {
    throwIfCancelled(signal);
    if (kind !== 'staged') change.fingerprint = await fileFingerprint(root, change.path, signal);
    else {
      const result = await client.run('ls-files', ['--stage', '-z', '--', change.path], signal, 1024 * 1024);
      change.fingerprint = createHash('sha256').update('index\0' + result.stdout).digest('hex');
    }
  }
}

async function fileFingerprint(root: string, relative: string, signal: AbortSignal): Promise<string> {
  const absolute = lexicalWorkspacePath(root, relative);
  let stat: fs.Stats;
  try { stat = fs.lstatSync(absolute); }
  catch { return createHash('sha256').update('missing').digest('hex'); }
  if (stat.isSymbolicLink()) return createHash('sha256').update('link\0' + fs.readlinkSync(absolute)).digest('hex');
  if (!stat.isFile()) return createHash('sha256').update(`other\0${stat.mode}\0${stat.size}`).digest('hex');
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    hash.update(`file\0${stat.mode}\0`);
    const stream = fs.createReadStream(absolute);
    const abort = () => stream.destroy(Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
    signal.addEventListener('abort', abort, { once: true });
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('close', () => signal.removeEventListener('abort', abort));
  });
}

function compareStates(baseline: GitBaseline, current: GitBaseline) {
  const before = stateMap(baseline), now = stateMap(current);
  const unchangedPreexisting: unknown[] = [], modifiedPreexisting: unknown[] = [], laterChanges: unknown[] = [], baselineChangesNoLongerPresent: unknown[] = [];
  for (const [key, item] of now) {
    const prior = before.get(key);
    const value = publicChange(item.change, item.category);
    if (!prior) laterChanges.push(value);
    else if (prior.change.fingerprint === item.change.fingerprint) unchangedPreexisting.push(value);
    else modifiedPreexisting.push(value);
  }
  for (const [key, item] of before) if (!now.has(key)) baselineChangesNoLongerPresent.push(publicChange(item.change, item.category));
  return { headChanged: baseline.head !== current.head, branchChanged: baseline.branch !== current.branch, unchangedPreexisting, modifiedPreexisting, laterChanges, baselineChangesNoLongerPresent };
}
function stateMap(state: GitBaseline): Map<string, { category: string; change: GitChange }> {
  const values = new Map<string, { category: string; change: GitChange }>();
  for (const category of ['staged', 'unstaged', 'untracked'] as const) for (const change of state[category]) values.set(`${category}\0${change.path}`, { category, change });
  return values;
}
function publicBaseline(value: GitBaseline) {
  return { capturedAt: value.capturedAt, branch: value.branch, detached: value.detached, head: value.head, staged: value.staged.map(change => publicChange(change, 'staged')), unstaged: value.unstaged.map(change => publicChange(change, 'unstaged')), untracked: value.untracked.map(change => publicChange(change, 'untracked')) };
}
function publicChange(change: GitChange, category: string) { return { category, path: change.path, status: change.status, originalPath: change.originalPath }; }
function matchingBaseline(baseline: GitBaseline | undefined, root: string): GitBaseline | undefined { return baseline?.version === 1 && baseline.workspaceRoot === root ? baseline : undefined; }
function emptyBaseline(root: string): GitBaseline { return { version: 1, capturedAt: new Date().toISOString(), workspaceRoot: root, repositoryRoot: null, repository: false, branch: null, detached: false, head: null, staged: [], unstaged: [], untracked: [] }; }

function parseLog(output: string): { commit: string; date: string; summary: string }[] {
  return output.split('\x1e').flatMap(record => {
    const [commit, date, summary] = record.trim().split('\x1f');
    return commit && date ? [{ commit, date, summary: summary ?? '' }] : [];
  });
}
function parseCommit(output: string): { commit: string; date: string; author: string; summary: string; body?: string } | undefined {
  const [commit, date, author, summary, body] = output.trim().split('\x1f');
  return commit && date ? { commit, date, author: author ?? '', summary: summary ?? '', body: body ? clip(body.trim(), 2000) : undefined } : undefined;
}
function parseBlame(output: string): { startLine: number; endLine: number; commit: string; date?: string; author?: string; summary?: string }[] {
  const metadata = new Map<string, { date?: string; author?: string; summary?: string }>();
  const lines: { line: number; commit: string; date?: string; author?: string; summary?: string }[] = [];
  let commit = '', finalLine = 0, current: { date?: string; author?: string; summary?: string } = {};
  for (const line of output.split('\n')) {
    const header = /^([0-9a-f^]{7,64})\s+\d+\s+(\d+)(?:\s+\d+)?$/.exec(line);
    if (header) { commit = header[1]; finalLine = Number(header[2]); current = { ...(metadata.get(commit) ?? {}) }; continue; }
    if (line.startsWith('author ')) current.author = line.slice(7);
    else if (line.startsWith('author-time ')) current.date = new Date(Number(line.slice(12)) * 1000).toISOString().slice(0, 10);
    else if (line.startsWith('summary ')) current.summary = line.slice(8);
    else if (line.startsWith('\t') && commit) { metadata.set(commit, current); lines.push({ line: finalLine, commit: commit.replace(/^\^/, ''), ...current }); }
  }
  const ranges: { startLine: number; endLine: number; commit: string; date?: string; author?: string; summary?: string }[] = [];
  for (const line of lines) {
    const prior = ranges.at(-1);
    if (prior && prior.commit === line.commit && prior.endLine + 1 === line.line) prior.endLine = line.line;
    else ranges.push({ startLine: line.line, endLine: line.line, commit: line.commit, date: line.date, author: line.author, summary: line.summary });
  }
  return ranges;
}

function linePage(tool: string, key: string, output: string, offset: number, maximum: number, extra: Record<string, unknown>): ToolExecutionOutput<unknown> {
  const lines = output ? output.replace(/\n$/, '').split('\n') : [];
  const page = lines.slice(offset, offset + Math.min(maximum, MAX_DIFF_LINES));
  while (page.length > 1 && Buffer.byteLength(page.join('\n')) > 32 * 1024) page.pop();
  const hasMore = offset + page.length < lines.length;
  return { data: { ...extra, startLine: offset + 1, endLine: offset + page.length, content: page.join('\n') }, resultCount: page.length, truncated: hasMore, continuationToken: hasMore ? encodeToken(tool, key, offset + page.length) : undefined, source: 'git' };
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
function safeGitPath(root: string, requested: string): string { lexicalWorkspacePath(root, requested); return requested.replace(/\\/g, '/').replace(/^\.\//, ''); }
function workspaceStatusPath(repositoryPath: string, workspacePrefix: string): string | undefined {
  if (!workspacePrefix) return repositoryPath;
  if (repositoryPath === workspacePrefix) return '.';
  return repositoryPath.startsWith(workspacePrefix + '/') ? repositoryPath.slice(workspacePrefix.length + 1) : undefined;
}
function lexicalWorkspacePath(root: string, requested: string): string {
  if (!requested || requested.includes('\0') || path.isAbsolute(requested) || path.win32.isAbsolute(requested)) fail('invalid_path', 'Git paths must be non-empty and workspace-relative.');
  const portable = requested.replace(/\\/g, '/');
  if (portable.split('/').includes('..')) fail('invalid_path', 'Parent-directory traversal is not allowed.');
  const rootAbsolute = path.resolve(root), candidate = path.resolve(rootAbsolute, portable);
  const relative = path.relative(rootAbsolute, candidate);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) fail('invalid_path', 'Git path escapes the workspace.');
  return candidate;
}
function gitPathSchema(): JsonSchema { return { type: 'string', minLength: 1, maxLength: 1024 }; }
function commitSchema(): JsonSchema { return { type: 'string', minLength: 7, maxLength: 64, pattern: '^[0-9a-fA-F]{7,64}$' }; }
function tokenSchema(): JsonSchema { return { type: 'string', minLength: 1, maxLength: MAX_TOKEN_LENGTH }; }
function clip(value: string, maximum: number): string { return value.length <= maximum ? value : value.slice(0, maximum - 1) + '…'; }
function fail(code: Parameters<typeof toolError>[0], message: string): never { throw new ToolFailure(toolError(code, message)); }
