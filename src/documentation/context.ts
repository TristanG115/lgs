import * as fs from 'node:fs';
import * as path from 'node:path';
import { GitClient, captureGitBaseline, type GitCommandRunner } from '../tools/git.js';
import { getFreshness, indexRepository, type RepositoryIndex } from '../intelligence/indexer.js';
import type { TaskState } from '../watchdog/types.js';
import type { DocumentationContext, DocumentationSource } from './types.js';

const MAX_DIFF = 40_000;
const MAX_DOCUMENTATION = 30_000;
const MAX_MAP = 20_000;

export async function collectDocumentationContext(workspaceRoot: string, taskState: TaskState, signal?: AbortSignal, runner?: GitCommandRunner): Promise<DocumentationContext> {
  const controllerSignal = signal ?? new AbortController().signal;
  const previous = readIndex(workspaceRoot);
  const current = indexRepository(workspaceRoot, previous);
  const changes = await collectChanges(workspaceRoot, controllerSignal, runner);
  const changedPaths = [...new Set([...changes.paths, ...taskState.recentModifications])].sort();
  const changed = new Set(changedPaths);
  const changedSymbols = current.files.filter(file => changed.has(file.path) && file.symbols.length).map(file => ({ path: file.path, symbols: file.symbols.slice(0, 50) }));
  const repositoryRelationships = current.moduleRelationships.filter(relation => changed.has(relation.from) || changed.has(relation.to)).slice(0, 200);
  const currentDocumentation = documentationSources(workspaceRoot, current);
  const codebaseMap = readBounded(path.join(workspaceRoot, '.lgs', 'CODEBASE_MAP.md'), MAX_MAP);
  return {
    objective: taskState.objective, acceptanceCriteria: [...taskState.acceptanceCriteria], diff: changes.diff,
    changedPaths, changedSymbols, repositoryRelationships, currentDocumentation, codebaseMap,
    taskState: cloneTaskState(taskState), changeKinds: classifyChanges(changedPaths, changes.diff, previous, current)
  };
}

async function collectChanges(root: string, signal: AbortSignal, runner?: GitCommandRunner): Promise<{ paths: string[]; diff: string }> {
  try {
    const baseline = await captureGitBaseline(root, signal, runner);
    if (!baseline.repository) return { paths: [], diff: 'Workspace is not a Git repository; task modifications are listed separately.' };
    const paths = [...baseline.staged, ...baseline.unstaged, ...baseline.untracked].flatMap(change => [change.path, ...(change.originalPath ? [change.originalPath] : [])]);
    const client = new GitClient(root, runner);
    const result = await client.tryRun('diff', ['HEAD', '--no-ext-diff', '--no-textconv', '--no-color', '--relative', '--', '.'], signal);
    const untracked = baseline.untracked.length ? `\nUntracked files:\n${baseline.untracked.map(change => `- ${change.path}`).join('\n')}` : '';
    return { paths, diff: bounded(stripGeneratedArtifacts(result?.stdout ?? '') + untracked, MAX_DIFF) };
  } catch (error) {
    if (signal.aborted) throw error;
    return { paths: [], diff: 'Git diff was unavailable; task modifications are listed separately.' };
  }
}

function documentationSources(root: string, index: RepositoryIndex): DocumentationSource[] {
  let remaining = MAX_DOCUMENTATION;
  return index.files.filter(file => file.likelyDocumentation).flatMap(file => {
    if (remaining <= 0) return [];
    const excerpt = readBounded(path.join(root, file.path), Math.min(8_000, remaining)); remaining -= excerpt.length;
    return [{ path: file.path, excerpt }];
  });
}
function classifyChanges(paths: string[], diff: string, previous: RepositoryIndex | undefined, current: RepositoryIndex): string[] {
  const kinds = new Set<string>();
  const before = new Set(previous?.files.map(file => file.path) ?? []), after = new Set(current.files.map(file => file.path));
  if (paths.some(file => !before.has(file) && after.has(file))) kinds.add('file-creation');
  if (paths.some(file => before.has(file) && !after.has(file))) kinds.add('file-deletion');
  if (/^rename (?:from|to) /m.test(diff)) kinds.add('file-rename');
  if (paths.some(file => /(?:package(?:-lock)?\.json|pnpm-lock\.yaml|requirements.*\.txt)$/.test(file))) kinds.add('dependency-change');
  if (paths.some(file => /(?:config|settings|configuration)/i.test(file))) kinds.add('configuration-change');
  const priorFiles = new Map(previous?.files.map(file => [file.path, file]) ?? []);
  const exportedSurfaceChanged = current.files.some(file => paths.includes(file.path) && file.exports.length > 0
    && JSON.stringify(file.exports) !== JSON.stringify(priorFiles.get(file.path)?.exports ?? []));
  if (/[+-]\s*export\s+(?:interface|type|class|function|const|enum)\b/.test(diff) || exportedSurfaceChanged) kinds.add('interface-change');
  if (paths.some(file => /(?:^|\/)test(?:s|\/)|\.(?:test|spec)\./.test(file))) kinds.add('major-test-change');
  if (paths.some(file => /^(?:src|lib|app)\//.test(file))) kinds.add('responsibility-change');
  if (paths.some(file => /(?:README|docs?\/|ARCHITECTURE)/i.test(file))) kinds.add('documentation-change');
  return [...kinds].sort();
}
function readIndex(root: string): RepositoryIndex | undefined { try { return JSON.parse(fs.readFileSync(path.join(root, '.lgs', 'index.json'), 'utf8')) as RepositoryIndex; } catch { return; } }
function stripGeneratedArtifacts(diff: string): string { return diff.split(/(?=^diff --git )/m).filter(block => !/^diff --git a\/\.lgs\/(?:CODEBASE_MAP\.md|index\.json)\b/.test(block)).join(''); }
function readBounded(file: string, maximum: number): string { try { return bounded(fs.readFileSync(file, 'utf8'), maximum); } catch { return ''; } }
function bounded(value: string, maximum: number): string { return value.length <= maximum ? value : value.slice(0, maximum) + '\n[truncated]'; }
function cloneTaskState(state: TaskState): TaskState { return { ...state, acceptanceCriteria: [...state.acceptanceCriteria], currentPlan: [...state.currentPlan], completedWork: [...state.completedWork], remainingWork: [...state.remainingWork], recentModifications: [...state.recentModifications], verifiedFacts: [...state.verifiedFacts], designDecisions: [...state.designDecisions], failedApproaches: [...state.failedApproaches], blockers: [...state.blockers] }; }

export function codebaseMapIsCurrent(root: string): boolean {
  try { const index = readIndex(root); if (!index) return false; const freshness = getFreshness(root, index); return freshness.index === 'current' && freshness.codebaseMap === 'current'; }
  catch { return false; }
}
