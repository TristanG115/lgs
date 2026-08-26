import { ToolFailure, type ToolPermission } from '../tools/types.js';
import { ToolRegistry, toolError } from '../tools/framework.js';
import { ResearchProviderUnavailableError } from './provider.js';
import { FileResearchStore } from './store.js';
import type { ResearchService } from './service.js';
import type { ResearchOperation } from './types.js';

const NETWORK_PERMISSION: ToolPermission = { access: 'execute', scope: 'workspace', network: true, category: 'network' };
const READ_PERMISSION: ToolPermission = { access: 'read-only', scope: 'workspace', network: false, category: 'read-only' };
const COMMON = {
  dependency: { type: 'string' as const, minLength: 1, maxLength: 300 }, relevantVersion: { type: 'string' as const, minLength: 1, maxLength: 200 },
  subtask: { type: 'string' as const, minLength: 1, maxLength: 500 }, maxAgeDays: { type: 'integer' as const, minimum: 1, maximum: 365 }
};

export function registerResearchTools(registry: ToolRegistry, research: ResearchService, store: FileResearchStore): ToolRegistry {
  for (const operation of ['web_search', 'documentation_search'] as const) registerSearch(registry, operation, research);
  registry.register({
    id: 'web_fetch', description: 'Fetch one public HTTP(S) source for a specific research purpose. Returns only concise relevant evidence with provenance; complete pages are never placed in context.', permission: NETWORK_PERMISSION,
    argumentSchema: { type: 'object', properties: { url: { type: 'string', minLength: 8, maxLength: 4000 }, purpose: { type: 'string', minLength: 1, maxLength: 2000 }, ...COMMON }, required: ['url', 'purpose'], additionalProperties: false },
    execute: (arguments_, context) => executeResearch(research, 'web_fetch', { ...arguments_, query: arguments_.url, url: arguments_.url, purpose: arguments_.purpose }, context)
  });
  registry.register({
    id: 'repository_search', description: 'Search external source repositories, using specialized GitHub code search when no configured repository-search provider is available. Prefer official repositories and include repo:owner/name when known.', permission: NETWORK_PERMISSION,
    argumentSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 4000 }, repository: { type: 'string', minLength: 3, maxLength: 300 }, ...COMMON }, required: ['query'], additionalProperties: false },
    execute: (arguments_, context) => {
      const repository = typeof arguments_.repository === 'string' ? ` repo:${arguments_.repository}` : '';
      return executeResearch(research, 'repository_search', { ...arguments_, query: `${arguments_.query as string}${repository}` }, context);
    }
  });
  registry.register({
    id: 'get_research_findings', description: 'Read concise task research findings and provenance already retained by LGS. This never returns full webpages.', permission: READ_PERMISSION,
    argumentSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } }, additionalProperties: false },
    execute: (arguments_, context) => {
      if (!context.taskId) throw new ToolFailure(toolError('invalid_request', 'Research findings require a task ID.'));
      const all = store.read(context.taskId); const limit = arguments_.limit as number | undefined ?? 20; const findings = all.slice(-limit);
      return { data: { findings, total: all.length }, resultCount: findings.length, truncated: findings.length < all.length, source: 'research' };
    }
  });
  return registry;
}

function registerSearch(registry: ToolRegistry, operation: 'web_search' | 'documentation_search', research: ResearchService): void {
  const description = operation === 'documentation_search'
    ? 'Search documentation for uncertain dependency or external API behavior. LGS reads local manifests first, enriches the query with exact versions, and prioritizes official documentation.'
    : 'Search the web when external behavior may be uncertain or outdated. LGS reads manifests first, prioritizes authoritative sources, deduplicates task research, and returns concise provenance.';
  registry.register({
    id: operation, description, permission: NETWORK_PERMISSION,
    argumentSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 4000 }, ...COMMON }, required: ['query'], additionalProperties: false },
    execute: (arguments_, context) => executeResearch(research, operation, arguments_, context)
  });
}

async function executeResearch(research: ResearchService, operation: ResearchOperation, arguments_: Record<string, unknown>, context: { taskId?: string; agentId?: string; signal: AbortSignal }) {
  if (!context.taskId) throw new ToolFailure(toolError('invalid_request', 'Research requires a task ID.'));
  try {
    const result = await research.research({
      operation, query: arguments_.query as string, url: arguments_.url as string | undefined, purpose: arguments_.purpose as string | undefined,
      taskId: context.taskId, requestingAgent: context.agentId ?? 'unknown-agent', subtask: arguments_.subtask as string | undefined,
      dependency: arguments_.dependency as string | undefined, relevantVersion: arguments_.relevantVersion as string | undefined,
      maxAgeDays: arguments_.maxAgeDays as number | undefined, signal: context.signal
    });
    return { data: result, resultCount: result.findings.length, source: 'research' as const };
  } catch (error) {
    if (error instanceof ResearchProviderUnavailableError) throw new ToolFailure(toolError('unsupported', error.message));
    throw error;
  }
}
