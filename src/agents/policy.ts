import type { ToolDefinition, ToolExecutionGuard, ToolIdentity } from '../tools/types.js';
import type { AgentProfileDefinition } from './types.js';

/** Enforces rare profile restrictions independently from model-visible instructions. */
export class AgentProfileExecutionGuard implements ToolExecutionGuard {
  constructor(private readonly resolve: (identity: ToolIdentity) => AgentProfileDefinition | undefined) {}
  check(definition: ToolDefinition, identity: ToolIdentity): string | undefined {
    const profile = this.resolve(identity); if (!profile) return;
    const restrictions = profile.policy.restrictions;
    if (restrictions.web === 'deny' && definition.permission.network) return `${profile.name} profile blocks web access.`;
    if (restrictions.commands === 'deny' && (commandCategories.has(definition.permission.category || 'read-only') || commandTool(definition.id))) return `${profile.name} profile blocks command execution.`;
    if (restrictions.code === 'deny' && definition.permission.access === 'execute' && codeTool(definition.id)) return `${profile.name} profile blocks source mutation.`;
  }
}
function commandTool(id: string): boolean { return /(?:command|verification|runtime|process|package|commit)/.test(id); }
function codeTool(id: string): boolean { return /(?:file|edit|patch|rename|delete)/.test(id); }
const commandCategories = new Set(['build', 'test', 'package-manager', 'git-mutation', 'process', 'dangerous']);
