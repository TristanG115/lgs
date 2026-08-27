import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ComputerConfiguration, ComputerOperationClass, ComputerPermissionDecision, ExternalAccess } from './types.js';
import { normalize } from './config.js';

export class ComputerPermissionResolver {
  constructor(private readonly configuration: ComputerConfiguration, private readonly workspaceRoot: string) {}

  filesystem(target: string, access: ExternalAccess): ComputerPermissionDecision {
    const canonical = canonicalPath(target); const workspace = canonicalPath(this.workspaceRoot);
    if (inside(workspace, canonical)) return { policy: 'always_allow', operation: 'workspace-execution', source: 'built-in', highRisk: false };
    const location = [...this.configuration.trustedLocations].sort((a, b) => b.path.length - a.path.length).find(item => inside(canonicalPath(item.path), canonical));
    if (location) return { policy: location[access], operation: access === 'read' ? 'system-inspection' : 'user-filesystem-modification', source: 'trusted-location', highRisk: access === 'write' };
    return { policy: access === 'read' ? this.configuration.readOutsideWorkspace : this.configuration.writeOutsideWorkspace, operation: access === 'read' ? 'system-inspection' : 'user-filesystem-modification', source: 'configuration', highRisk: access === 'write' };
  }

  command(operation: ComputerOperationClass): ComputerPermissionDecision {
    const policy = operation === 'elevated-administrator' ? this.configuration.elevatedCommandPolicy
      : operation === 'system-software-management' || operation === 'user-software-management' ? this.configuration.packageInstallationPolicy
      : this.configuration.systemCommandPolicy;
    return { policy, operation, source: 'configuration', highRisk: operation === 'elevated-administrator' || operation.includes('software-management') };
  }
}
function canonicalPath(value: string): string { const candidate = normalize(value); try { return fs.realpathSync(candidate); } catch { return path.resolve(candidate); } }
function inside(root: string, target: string): boolean { const relative = path.relative(root, target); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); }
