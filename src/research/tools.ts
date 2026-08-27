import { ToolFailure, type ToolPermission } from '../tools/types.js';
import { ToolRegistry, toolError } from '../tools/framework.js';
import { ResearchProviderUnavailableError } from './provider.js';
import { FileResearchStore } from './store.js';
import type { ResearchService } from './service.js';
import type { ResearchCycleEngine } from './cycles.js';
import type { FileResearchRequirementStore } from './policy.js';
import type { EvidenceState, ResearchConclusion, ResearchOperation } from './types.js';

const NETWORK_PERMISSION: ToolPermission = { access: 'execute', scope: 'workspace', network: true, category: 'network' };
const READ_PERMISSION: ToolPermission = { access: 'read-only', scope: 'workspace', network: false, category: 'read-only' };
const COMMON = {
  dependency: { type: 'string' as const, minLength: 1, maxLength: 300 }, relevantVersion: { type: 'string' as const, minLength: 1, maxLength: 200 },
  subtask: { type: 'string' as const, minLength: 1, maxLength: 500 }, maxAgeDays: { type: 'integer' as const, minimum: 1, maximum: 365 }
};

export function registerResearchTools(registry: ToolRegistry, research: ResearchService, store: FileResearchStore, cycles?: ResearchCycleEngine, requirements?: FileResearchRequirementStore): ToolRegistry {
  for (const operation of ['web_search', 'documentation_search'] as const) registerSearch(registry, operation, research, requirements);
  registry.register({
    id: 'web_fetch', description: 'Fetch one public HTTP(S) source for a specific research purpose. Returns only concise relevant evidence with provenance; complete pages are never placed in context.', permission: NETWORK_PERMISSION,
    argumentSchema: { type: 'object', properties: { url: { type: 'string', minLength: 8, maxLength: 4000 }, purpose: { type: 'string', minLength: 1, maxLength: 2000 }, ...COMMON }, required: ['url', 'purpose'], additionalProperties: false },
    execute: (arguments_, context) => executeResearch(research, 'web_fetch', { ...arguments_, query: arguments_.url, url: arguments_.url, purpose: arguments_.purpose }, context, requirements)
  });
  registry.register({
    id: 'repository_search', description: 'Search external source repositories, using specialized GitHub code search when no configured repository-search provider is available. Prefer official repositories and include repo:owner/name when known.', permission: NETWORK_PERMISSION,
    argumentSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 4000 }, repository: { type: 'string', minLength: 3, maxLength: 300 }, ...COMMON }, required: ['query'], additionalProperties: false },
    execute: (arguments_, context) => {
      const repository = typeof arguments_.repository === 'string' ? ` repo:${arguments_.repository}` : '';
      return executeResearch(research, 'repository_search', { ...arguments_, query: `${arguments_.query as string}${repository}` }, context, requirements);
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
  if (cycles) registerCycleTools(registry, cycles);
  if (requirements) registry.register({ id: 'research_require', description: 'Manager-enforced research barrier for an uncertain, unfamiliar, version-sensitive, or unsupported external assumption.', permission: NETWORK_PERMISSION, argumentSchema: { type: 'object', properties: { trigger: { type: 'string', enum: ['explicit-request', 'explicit-uncertainty', 'unfamiliar-behavior', 'version-sensitive-assumption', 'unsupported-external-assumption', 'watchdog-needs-research', 'proactive-decision'] }, reason: { type: 'string', minLength: 1, maxLength: 2000 } }, required: ['trigger', 'reason'], additionalProperties: false }, execute: (args, context) => { if (!context.taskId) throw new ToolFailure(toolError('invalid_request', 'A task ID is required.')); return { data: requirements.require(context.taskId, args.trigger as import('./types.js').ResearchTrigger, args.reason as string), resultCount: 1, source: 'research' }; } });
  return registry;
}

function registerSearch(registry: ToolRegistry, operation: 'web_search' | 'documentation_search', research: ResearchService, requirements?: FileResearchRequirementStore): void {
  const description = operation === 'documentation_search'
    ? 'Search documentation for uncertain dependency or external API behavior. LGS reads local manifests first, enriches the query with exact versions, and prioritizes official documentation.'
    : 'Search the web when external behavior may be uncertain or outdated. LGS reads manifests first, prioritizes authoritative sources, deduplicates task research, and returns concise provenance.';
  registry.register({
    id: operation, description, permission: NETWORK_PERMISSION,
    argumentSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 4000 }, ...COMMON }, required: ['query'], additionalProperties: false },
    execute: (arguments_, context) => executeResearch(research, operation, arguments_, context, requirements)
  });
}

async function executeResearch(research: ResearchService, operation: ResearchOperation, arguments_: Record<string, unknown>, context: { taskId?: string; agentId?: string; signal: AbortSignal }, requirements?: FileResearchRequirementStore) {
  if (!context.taskId) throw new ToolFailure(toolError('invalid_request', 'Research requires a task ID.'));
  try {
    const result = await research.research({
      operation, query: arguments_.query as string, url: arguments_.url as string | undefined, purpose: arguments_.purpose as string | undefined,
      taskId: context.taskId, requestingAgent: context.agentId ?? 'unknown-agent', subtask: arguments_.subtask as string | undefined,
      dependency: arguments_.dependency as string | undefined, relevantVersion: arguments_.relevantVersion as string | undefined,
      maxAgeDays: arguments_.maxAgeDays as number | undefined, signal: context.signal
    });
    requirements?.satisfy(context.taskId, result.findings);
    return { data: result, resultCount: result.findings.length, source: 'research' as const };
  } catch (error) {
    if (error instanceof ResearchProviderUnavailableError) throw new ToolFailure(toolError('unsupported', error.message));
    throw error;
  }
}

function registerCycleTools(registry: ToolRegistry, cycles: ResearchCycleEngine): void {
  registry.register({ id: 'research_start_cycle', description: 'Start a durable research cycle after deterministic novelty and budget checks.', permission: NETWORK_PERMISSION, argumentSchema: { type: 'object', properties: { question: { type: 'string', minLength: 1, maxLength: 4000 }, hypothesis: { type: 'string', minLength: 1, maxLength: 4000 }, confidence: { type: 'integer', minimum: 0, maximum: 100 }, experiment: { type: 'string', minLength: 1, maxLength: 4000 }, expectedObservation: { type: 'string', minLength: 1, maxLength: 4000 }, nextAction: { type: 'string', maxLength: 2000 }, repetitionJustification: { type: 'string', maxLength: 2000 } }, required: ['question', 'hypothesis', 'confidence', 'experiment', 'expectedObservation'], additionalProperties: false }, execute: (args, context) => { if (!context.taskId) throw new ToolFailure(toolError('invalid_request', 'A task ID is required.')); return { data: cycles.start(context.taskId, { question: args.question as string, hypothesis: args.hypothesis as string, confidence: (args.confidence as number) / 100, experiment: args.experiment as string, expectedObservation: args.expectedObservation as string, nextAction: args.nextAction as string | undefined, repetitionJustification: args.repetitionJustification as string | undefined }), resultCount: 1, source: 'research' }; } });
  registry.register({ id: 'research_complete_cycle', description: 'Record actual observation, analysis, conclusion, learning, provenance, and next action even when an experiment fails.', permission: NETWORK_PERMISSION, argumentSchema: { type: 'object', properties: { cycleId: { type: 'string', minLength: 1, maxLength: 128 }, actualObservation: { type: 'string', minLength: 1, maxLength: 6000 }, analysis: { type: 'string', minLength: 1, maxLength: 6000 }, conclusion: { type: 'string', enum: ['SUPPORTED', 'REJECTED', 'PARTIAL', 'INCONCLUSIVE'] }, learned: { type: 'string', minLength: 1, maxLength: 4000 }, evidence: { type: 'array', maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 1000 } }, nextAction: { type: 'string', minLength: 1, maxLength: 2000 }, bestExplanation: { type: 'string', maxLength: 6000 }, remainingUnknowns: { type: 'array', maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 1000 } }, recommendation: { type: 'string', maxLength: 4000 } }, required: ['cycleId', 'actualObservation', 'analysis', 'conclusion', 'learned', 'nextAction'], additionalProperties: false }, execute: (args, context) => { if (!context.taskId) throw new ToolFailure(toolError('invalid_request', 'A task ID is required.')); return { data: cycles.complete(context.taskId, args.cycleId as string, { actualObservation: args.actualObservation as string, analysis: args.analysis as string, conclusion: args.conclusion as ResearchConclusion, learned: args.learned as string, evidence: args.evidence as string[] | undefined, nextAction: args.nextAction as string, bestExplanation: args.bestExplanation as string | undefined, remainingUnknowns: args.remainingUnknowns as string[] | undefined, recommendation: args.recommendation as string | undefined }), resultCount: 1, source: 'research' }; } });
  registry.register({ id: 'research_add_evidence', description: 'Record a research claim with an explicit evidence state and provenance. Hypotheses are not promoted to facts implicitly.', permission: NETWORK_PERMISSION, argumentSchema: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 128 }, claim: { type: 'string', minLength: 1, maxLength: 4000 }, state: { type: 'string', enum: ['CONFIRMED', 'STRONG', 'WEAK', 'HYPOTHESIS', 'REJECTED'] }, provenance: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 1000 } } }, required: ['id', 'claim', 'state', 'provenance'], additionalProperties: false }, execute: (args, context) => { if (!context.taskId) throw new ToolFailure(toolError('invalid_request', 'A task ID is required.')); return { data: cycles.addEvidence(context.taskId, [{ id: args.id as string, claim: args.claim as string, state: args.state as EvidenceState, provenance: args.provenance as string[], recordedAt: new Date().toISOString() }]), resultCount: 1, source: 'research' }; } });
}
