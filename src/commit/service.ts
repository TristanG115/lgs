import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type { CompletionGuard } from '../completion/guard.js';
import type { GitBaseline } from '../tools/git.js';
import type { FileTaskStateStore } from '../watchdog/state.js';

const run = promisify(execFile);
const SECRET = /(api[_-]?key|secret|password|authorization|bearer)\s*[:=]\s*['"]?[^\s'"]+/i;

export type VerifiedCommitInput = { type: string; scope: string; summary: string; changes: string; documentation: string; verification: string };

export class VerifiedCommitService {
  constructor(private readonly root: string, private readonly guard: CompletionGuard, private readonly tasks: FileTaskStateStore, private readonly baseline: GitBaseline) {}

  async commit(taskId: string, input: VerifiedCommitInput): Promise<{ sha: string; files: string[] }> {
    if (!this.baseline.repository || !this.baseline.repositoryRoot) throw new Error('Verified commits require a Git baseline captured inside a repository.');
    const task = this.tasks.read(taskId);
    if (!task) throw new Error('Task state was not initialized.');
    const files = [...new Set(task.recentModifications.map(file => this.safePath(file)))];
    if (!files.length) throw new Error('No task-attributable changes are recorded.');
    if (files.some(file => this.preexisting(file))) throw new Error('Task changes overlap preexisting user changes; separate hunks manually before committing.');
    if (this.guard.evaluate(taskId).status !== 'passed') throw new Error('Completion Guard has not passed; LGS will not commit incomplete work.');
    const alreadyStaged = (await this.git(['diff', '--cached', '--name-only', '--'])).stdout.trim();
    if (alreadyStaged) throw new Error('The Git index already contains changes. Review and unstage them before LGS creates a verified commit.');
    const changed = (await this.git(['status', '--porcelain=v1', '--untracked-files=all', '--', ...files])).stdout;
    if (!changed.trim()) throw new Error('No task-attributable changes are available to commit.');
    const diff = (await this.git(['diff', '--no-ext-diff', '--no-textconv', '--', ...files])).stdout;
    if (SECRET.test(diff) || files.some(file => this.fileContainsSecret(file))) throw new Error('Potential secret detected in task diff; commit blocked.');
    await this.git(['add', '--', ...files]);
    const stagedFiles = (await this.git(['diff', '--cached', '--name-only', '--no-renames', '--'])).stdout.split('\n').filter(Boolean).sort();
    if (JSON.stringify(stagedFiles) !== JSON.stringify([...files].sort())) throw new Error('Staged files differ from task-tracked changes; commit blocked for manual review.');
    const stagedCheck = (await this.git(['diff', '--cached', '--check'])).stdout;
    if (stagedCheck) throw new Error(`Staged diff failed checks: ${stagedCheck}`);
    const stagedDiff = (await this.git(['diff', '--cached', '--no-ext-diff', '--no-textconv', '--', ...files])).stdout;
    if (SECRET.test(stagedDiff)) throw new Error('Potential secret detected in staged diff; commit blocked.');
    if (this.guard.evaluate(taskId).status !== 'passed') throw new Error('Completion evidence is no longer valid; LGS will not commit.');
    const message = `${input.type}(${input.scope}): ${input.summary}\n\nGoal\n----\n${task.objective}\n\nChanges\n-------\n${input.changes}\n\nDocumentation\n-------------\n${input.documentation}\n\nVerification\n------------\n${input.verification}\n\nFiles\n-----\n${files.join(', ')}\n\nLGS-Task: ${taskId}`;
    await this.git(['commit', '-m', message]);
    const sha = (await this.git(['rev-parse', 'HEAD'])).stdout.trim();
    this.tasks.update(taskId, { completedWork: [...task.completedWork, `Committed ${sha}`], commitSha: sha });
    return { sha, files };
  }

  private preexisting(file: string): boolean {
    return [...this.baseline.staged, ...this.baseline.unstaged, ...this.baseline.untracked]
      .some(change => change.path === file || change.originalPath === file);
  }

  private safePath(file: string): string {
    if (!file || file.includes('\0') || path.isAbsolute(file)) throw new Error('Task modification path is invalid.');
    const relative = path.relative(this.root, path.resolve(this.root, file));
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Task modification path is outside the workspace.');
    return relative.split(path.sep).join('/');
  }

  private fileContainsSecret(file: string): boolean {
    try { return SECRET.test(fs.readFileSync(path.join(this.root, file), 'utf8')); }
    catch { return false; }
  }

  private git(args: string[]) { return run('git', ['-C', this.root, ...args], { encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }); }
}
