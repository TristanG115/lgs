import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GitBaselineStore, ToolExecutor, captureGitBaseline, createGitToolRegistry,
  type GitCommandRunner
} from '../src/tools/index.js';

function git(root: string, arguments_: string[]): string {
  return execFileSync('git', arguments_, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).trim();
}
function repository(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lgs-git-'));
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.email', 'lgs@example.test']);
  git(root, ['config', 'user.name', 'LGS Test']);
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'first\n');
  fs.writeFileSync(path.join(root, 'other.txt'), 'other\n');
  git(root, ['add', 'tracked.txt', 'other.txt']);
  git(root, ['commit', '--quiet', '-m', 'initial behavior']);
  return root;
}
function cleanup(root: string): void { fs.rmSync(root, { recursive: true, force: true }); }
function call(id: string, arguments_: Record<string, unknown>) { return { id, arguments: arguments_ }; }

describe('Git task baseline', () => {
  it('captures a clean repository, branch, and HEAD', async () => {
    const root = repository();
    const baseline = await captureGitBaseline(root);
    expect(baseline.repository).toBe(true);
    expect(baseline.branch).toBeTypeOf('string');
    expect(baseline.head).toMatch(/^[0-9a-f]{40,64}$/);
    expect(baseline).toMatchObject({ detached: false, staged: [], unstaged: [], untracked: [] });
    cleanup(root);
  });

  it('captures staged, unstaged, and untracked files with durable fingerprints', async () => {
    const root = repository();
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'unstaged\n');
    fs.writeFileSync(path.join(root, 'other.txt'), 'staged\n');
    git(root, ['add', 'other.txt']);
    fs.writeFileSync(path.join(root, 'new.txt'), 'untracked\n');
    const baseline = await captureGitBaseline(root);
    expect(baseline.staged).toMatchObject([{ path: 'other.txt', status: 'M' }]);
    expect(baseline.unstaged).toMatchObject([{ path: 'tracked.txt', status: 'M' }]);
    expect(baseline.untracked).toMatchObject([{ path: 'new.txt', status: 'untracked' }]);
    expect([...baseline.staged, ...baseline.unstaged, ...baseline.untracked].every(change => /^[0-9a-f]{64}$/.test(change.fingerprint ?? ''))).toBe(true);
    cleanup(root);
  });

  it('distinguishes preserved user changes from later modifications throughout a stored task', async () => {
    const root = repository();
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'user change\n');
    fs.writeFileSync(path.join(root, 'existing.txt'), 'preexisting\n');
    const store = new GitBaselineStore();
    const baseline = await store.ensure('task-1', root);
    expect((await store.ensure('task-1', root)).capturedAt).toBe(baseline.capturedAt);
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'user change plus later edit\n');
    fs.writeFileSync(path.join(root, 'later.txt'), 'later\n');
    const result = await new ToolExecutor(createGitToolRegistry({ baseline }), root).execute(call('git_status', {}));
    const comparison = (result.data as { comparison: Record<string, { path: string }[]> }).comparison;
    expect(comparison.modifiedPreexisting.map(change => change.path)).toContain('tracked.txt');
    expect(comparison.unchangedPreexisting.map(change => change.path)).toContain('existing.txt');
    expect(comparison.laterChanges.map(change => change.path)).toContain('later.txt');
    expect(store.serialize()['task-1'].head).toBe(baseline.head);
    cleanup(root);
  });

  it('handles detached HEAD and repositories without commits', async () => {
    const root = repository();
    git(root, ['checkout', '--quiet', '--detach', 'HEAD']);
    expect(await captureGitBaseline(root)).toMatchObject({ repository: true, branch: null, detached: true });
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'lgs-git-empty-'));
    git(empty, ['init', '--quiet']);
    expect(await captureGitBaseline(empty)).toMatchObject({ repository: true, head: null, detached: false });
    cleanup(root); cleanup(empty);
  });

  it('keeps a workspace without Git usable', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lgs-no-git-'));
    const baseline = await captureGitBaseline(root);
    expect(baseline).toMatchObject({ repository: false, branch: null, head: null });
    const executor = new ToolExecutor(createGitToolRegistry({ baseline }), root);
    expect(await executor.execute(call('git_status', {}))).toMatchObject({ status: 'success', data: { repository: false } });
    expect((await executor.execute(call('git_file_history', { path: 'missing.ts' }))).error?.code).toBe('unsupported');
    cleanup(root);
  });
});

describe('structured Git tools', () => {
  it('registers all six Git tools as read-only workspace tools', () => {
    const tools = createGitToolRegistry().list();
    expect(tools.map(tool => tool.id)).toEqual(['git_status', 'git_diff', 'git_file_history', 'git_show_commit', 'git_blame_range', 'git_log_search']);
    expect(tools.every(tool => tool.permission.access === 'read-only' && tool.permission.network === false)).toBe(true);
  });

  it('returns compact file history and supports explicit commit details and diffs', async () => {
    const root = repository();
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'first\nsecond\n');
    git(root, ['add', 'tracked.txt']);
    git(root, ['commit', '--quiet', '-m', 'extend tracked behavior']);
    const executor = new ToolExecutor(createGitToolRegistry(), root);
    const history = await executor.execute(call('git_file_history', { path: 'tracked.txt', pageSize: 10 }));
    const commits = (history.data as { commits: { commit: string; summary: string }[] }).commits;
    expect(commits.map(commit => commit.summary)).toEqual(['extend tracked behavior', 'initial behavior']);
    const recent = await executor.execute(call('git_file_history', { path: 'tracked.txt', pageSize: 1 }));
    expect(recent.metadata.continuationToken).toBeTypeOf('string');
    const older = await executor.execute(call('git_file_history', { path: 'tracked.txt', pageSize: 1, continuationToken: recent.metadata.continuationToken }));
    expect(JSON.stringify(older.data)).toContain('initial behavior');
    const shown = await executor.execute(call('git_show_commit', { commit: commits[0].commit }));
    expect(shown.data).toMatchObject({ includeDiff: false, files: ['tracked.txt'] });
    const patch = await executor.execute(call('git_show_commit', { commit: commits[0].commit, includeDiff: true, maxLines: 100 }));
    expect((patch.data as { content: string }).content).toContain('+second');
    const commitDiff = await executor.execute(call('git_diff', { scope: 'commit', commit: commits[0].commit, path: 'tracked.txt' }));
    expect((commitDiff.data as { content: string }).content).toContain('+second');
    cleanup(root);
  });

  it('keeps status and paths scoped to a nested workspace', async () => {
    const root = repository();
    fs.mkdirSync(path.join(root, 'nested'));
    fs.writeFileSync(path.join(root, 'nested', 'inside.txt'), 'inside\n');
    git(root, ['add', 'nested/inside.txt']);
    git(root, ['commit', '--quiet', '-m', 'add nested workspace']);
    fs.writeFileSync(path.join(root, 'nested', 'inside.txt'), 'changed inside\n');
    fs.writeFileSync(path.join(root, 'outside.txt'), 'outside\n');
    const baseline = await captureGitBaseline(path.join(root, 'nested'));
    expect(baseline.unstaged.map(change => change.path)).toEqual(['inside.txt']);
    expect(baseline.untracked).toEqual([]);
    cleanup(root);
  });

  it('returns staged and unstaged diffs, blame ranges, and commit-message search', async () => {
    const root = repository();
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'first\nsecond\n');
    git(root, ['add', 'tracked.txt']);
    git(root, ['commit', '--quiet', '-m', 'searchable history phrase']);
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'first\nsecond\nthird\n');
    fs.writeFileSync(path.join(root, 'other.txt'), 'staged edit\n');
    git(root, ['add', 'other.txt']);
    const executor = new ToolExecutor(createGitToolRegistry(), root);
    expect((await executor.execute(call('git_diff', { scope: 'unstaged', path: 'tracked.txt' }))).data).toMatchObject({ scope: 'unstaged' });
    expect(JSON.stringify((await executor.execute(call('git_diff', { scope: 'staged' }))).data)).toContain('staged edit');
    const blame = await executor.execute(call('git_blame_range', { path: 'tracked.txt', startLine: 1, endLine: 2 }));
    expect((blame.data as { ranges: unknown[] }).ranges.length).toBeGreaterThan(0);
    const search = await executor.execute(call('git_log_search', { query: 'searchable history' }));
    expect(JSON.stringify(search.data)).toContain('searchable history phrase');
    cleanup(root);
  });

  it('rejects unsafe paths and revisions and passes hostile search text as one argument', async () => {
    const root = repository();
    const executor = new ToolExecutor(createGitToolRegistry(), root);
    expect((await executor.execute(call('git_file_history', { path: '../outside' }))).error?.code).toBe('invalid_path');
    expect((await executor.execute(call('git_show_commit', { commit: '--all' }))).error?.code).toBe('invalid_request');
    const observed: readonly string[][] = [];
    const runner: GitCommandRunner = async (_cwd, arguments_) => {
      (observed as string[][]).push([...arguments_]);
      return { stdout: arguments_[0] === 'rev-parse' ? 'true\n' : '', stderr: '' };
    };
    const safeExecutor = new ToolExecutor(createGitToolRegistry({ runner }), root);
    expect((await safeExecutor.execute(call('git_log_search', { query: '$(touch should-not-run)' }))).status).toBe('success');
    expect(observed.some(arguments_ => arguments_.includes('--grep=$(touch should-not-run)'))).toBe(true);
    cleanup(root);
  });
});
