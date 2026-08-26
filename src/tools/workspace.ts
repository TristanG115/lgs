import { registerGitTools, type GitBaseline, type GitCommandRunner } from './git.js';
import { createRepositoryToolRegistry } from './repository.js';
import type { ToolRegistry } from './framework.js';
import { registerVerificationTools, type VerificationRunner } from '../verification/index.js';
import type { RawExecutionLogStore } from '../execution/index.js';
import { registerCompletionTools, type CompletionGuard, type FileCompletionEvidenceStore } from '../completion/index.js';

export function createWorkspaceToolRegistry(options: { gitBaseline?: GitBaseline; gitRunner?: GitCommandRunner; verificationRunner?: VerificationRunner; executionLogs?: RawExecutionLogStore; completionGuard?: CompletionGuard; completionEvidence?: FileCompletionEvidenceStore } = {}): ToolRegistry {
  const registry = registerGitTools(createRepositoryToolRegistry(), { baseline: options.gitBaseline, runner: options.gitRunner });
  if (options.verificationRunner && options.executionLogs) registerVerificationTools(registry, options.verificationRunner, options.executionLogs);
  if (options.completionGuard && options.completionEvidence) registerCompletionTools(registry, options.completionGuard, options.completionEvidence);
  return registry;
}
