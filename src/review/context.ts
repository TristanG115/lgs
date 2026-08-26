import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FileDocumentationAuditStore } from '../documentation/store.js';
import { collectDocumentationContext } from '../documentation/context.js';
import type { FileTaskEvidenceStore } from '../execution/evidence.js';
import type { FileResearchStore } from '../research/store.js';
import { GitClient, type GitBaseline, type GitCommandRunner } from '../tools/git.js';
import type { FileTaskStateStore } from '../watchdog/state.js';
import type { ReviewContext, ReviewSource } from './types.js';

const MAX_SOURCE_TOTAL = 50_000;
const MAX_FILE = 10_000;

export async function collectReviewContext(
  workspaceRoot: string, taskId: string, taskState: FileTaskStateStore, executions: FileTaskEvidenceStore,
  research: FileResearchStore, documentation: FileDocumentationAuditStore, signal?: AbortSignal, baseline?: GitBaseline, runner?: GitCommandRunner
): Promise<ReviewContext> {
  const state = taskState.read(taskId);
  if (!state) throw new Error('Task state was not initialized.');
  const engineering = await collectDocumentationContext(workspaceRoot, state, signal, runner);
  const diff = await baselineDiff(workspaceRoot, engineering.diff, baseline, signal ?? new AbortController().signal, runner);
  const changedPaths = [...new Set([...engineering.changedPaths, ...diffPaths(diff)])].sort();
  const paths = changedPaths.filter(file => safeWorkspaceFile(workspaceRoot, file));
  const testPaths = paths.filter(isTest);
  const sourcePaths = paths.filter(file => !isTest(file) && !isDocumentation(file));
  const audit = documentation.read(taskId);
  return {
    objective: state.objective, acceptanceCriteria: [...state.acceptanceCriteria], diff,
    relevantSource: readSources(workspaceRoot, sourcePaths), tests: readSources(workspaceRoot, testPaths),
    verificationResults: executions.read(taskId).slice(-30).map(entry => ({
      step: entry.verificationStep, command: entry.execution.normalized.command, status: entry.execution.status,
      completedAt: entry.execution.completedAt, primaryError: entry.execution.normalized.primaryError
    })),
    researchFindings: research.read(taskId).slice(-30),
    documentationChanges: {
      changedFiles: changedPaths.filter(isDocumentation), auditCurrent: audit ? documentation.isCurrent(audit) : false,
      assessments: audit?.assessments.map(item => ({ ...item, affectedFiles: [...item.affectedFiles] })) ?? []
    },
    preexistingUserChanges: baseline ? [
      ...baseline.staged.map(change => ({ path: change.path, status: change.status, category: 'staged' as const })),
      ...baseline.unstaged.map(change => ({ path: change.path, status: change.status, category: 'unstaged' as const })),
      ...baseline.untracked.map(change => ({ path: change.path, status: change.status, category: 'untracked' as const }))
    ] : []
  };
}

async function baselineDiff(root: string, fallback: string, baseline: GitBaseline | undefined, signal: AbortSignal, runner?: GitCommandRunner): Promise<string> {
  if (!baseline?.repository || !baseline.head) return fallback;
  try {
    const result = await new GitClient(root, runner).run('diff', ['--no-ext-diff', '--no-textconv', '--no-color', '--relative', baseline.head, '--', '.'], signal);
    const untracked = fallback.match(/\nUntracked files:\n[\s\S]*$/)?.[0] ?? '';
    return bounded(stripGenerated(result.stdout) + untracked, 60_000);
  } catch (error) { if (signal.aborted) throw error; return fallback; }
}
function diffPaths(diff: string): string[] { return [...diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)].flatMap(match => [match[1], match[2]]).filter(path => !path.startsWith('.lgs/')); }
function stripGenerated(diff: string): string { return diff.split(/(?=^diff --git )/m).filter(block => !/^diff --git a\/\.lgs\/(?:CODEBASE_MAP\.md|index\.json)\b/.test(block)).join(''); }
function bounded(value: string, maximum: number): string { return value.length <= maximum ? value : value.slice(0, maximum) + '\n[truncated]'; }

function readSources(root: string, paths: string[]): ReviewSource[] {
  let remaining = MAX_SOURCE_TOTAL;
  return paths.flatMap(relative => {
    if (remaining <= 0) return [];
    try { const content = fs.readFileSync(path.join(root, relative), 'utf8').slice(0, Math.min(MAX_FILE, remaining)); remaining -= content.length; return [{ path: relative, content }]; }
    catch { return []; }
  });
}
function safeWorkspaceFile(root: string, relative: string): boolean {
  if (!relative || relative.includes('\0') || path.isAbsolute(relative)) return false;
  try {
    const realRoot = fs.realpathSync(root); const candidate = path.resolve(realRoot, relative); const lexical = path.relative(realRoot, candidate);
    if (lexical === '..' || lexical.startsWith('..' + path.sep) || path.isAbsolute(lexical)) return false;
    const real = fs.realpathSync(candidate); const resolved = path.relative(realRoot, real);
    return resolved !== '..' && !resolved.startsWith('..' + path.sep) && !path.isAbsolute(resolved) && fs.statSync(real).isFile();
  } catch { return false; }
}
function isTest(file: string): boolean { return /(?:^|\/)test(?:s|\/)|\.(?:test|spec)\.[^.]+$/.test(file); }
function isDocumentation(file: string): boolean { return /(?:README|docs?\/|ARCHITECTURE|\.md$|\.rst$)/i.test(file); }
