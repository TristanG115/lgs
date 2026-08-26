import { registerGitTools, type GitBaseline, type GitCommandRunner } from './git.js';
import { createRepositoryToolRegistry } from './repository.js';
import type { ToolRegistry } from './framework.js';

export function createWorkspaceToolRegistry(options: { gitBaseline?: GitBaseline; gitRunner?: GitCommandRunner } = {}): ToolRegistry {
  return registerGitTools(createRepositoryToolRegistry(), { baseline: options.gitBaseline, runner: options.gitRunner });
}
