import { registerGitTools, type GitBaseline, type GitCommandRunner } from './git.js';
import { createRepositoryToolRegistry } from './repository.js';
import type { ToolRegistry } from './framework.js';
import { registerVerificationTools, type VerificationRunner } from '../verification/index.js';
import type { RawExecutionLogStore } from '../execution/index.js';

export function createWorkspaceToolRegistry(options: { gitBaseline?: GitBaseline; gitRunner?: GitCommandRunner; verificationRunner?: VerificationRunner; executionLogs?: RawExecutionLogStore } = {}): ToolRegistry {
  const registry = registerGitTools(createRepositoryToolRegistry(), { baseline: options.gitBaseline, runner: options.gitRunner });
  return options.verificationRunner && options.executionLogs ? registerVerificationTools(registry, options.verificationRunner, options.executionLogs) : registry;
}
