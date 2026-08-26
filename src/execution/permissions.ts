import * as path from 'node:path';
import type { ExecutionRequest, PermissionConfiguration, PermissionResolution } from './types.js';

export class CommandPermissionResolver {
  constructor(
    private readonly user: PermissionConfiguration = {},
    private readonly workspace: PermissionConfiguration = {},
    private readonly fallback: PermissionConfiguration['default'] = 'ask'
  ) {}

  resolve(request: ExecutionRequest): PermissionResolution {
    const executable = path.basename(request.executable).toLowerCase();
    const workspaceExecutable = findExecutable(this.workspace, executable);
    if (workspaceExecutable) return { policy: workspaceExecutable, source: 'workspace' };
    const workspaceCategory = this.workspace.categories?.[request.category];
    if (workspaceCategory) return { policy: workspaceCategory, source: 'workspace' };
    if (this.workspace.default) return { policy: this.workspace.default, source: 'workspace' };
    const userExecutable = findExecutable(this.user, executable);
    if (userExecutable) return { policy: userExecutable, source: 'user' };
    const userCategory = this.user.categories?.[request.category];
    if (userCategory) return { policy: userCategory, source: 'user' };
    if (this.user.default) return { policy: this.user.default, source: 'user' };
    return { policy: this.fallback ?? 'ask', source: 'built-in' };
  }
}

function findExecutable(configuration: PermissionConfiguration, executable: string) {
  return Object.entries(configuration.executables ?? {}).find(([candidate]) => candidate.toLowerCase() === executable)?.[1];
}

