import { ToolFailure, type ToolPermission } from '../tools/types.js';
import { ToolRegistry, toolError } from '../tools/framework.js';
import { FileCompletionEvidenceStore, RECORDABLE_REQUIREMENTS } from './evidence.js';
import type { CompletionGuard } from './guard.js';
import type { CompletionRequirement } from './types.js';

const METADATA_PERMISSION: ToolPermission = { access: 'execute', scope: 'workspace', network: false, category: 'process' };
const READ_PERMISSION: ToolPermission = { access: 'read-only', scope: 'workspace', network: false, category: 'read-only' };

export function registerCompletionTools(registry: ToolRegistry, guard: CompletionGuard, evidence: FileCompletionEvidenceStore): ToolRegistry {
  registry.register({
    id: 'record_completion_evidence', description: 'Record durable evidence for a model-assessed completion requirement. Command, failure, and CODEBASE_MAP gates cannot be self-attested.', permission: METADATA_PERMISSION,
    argumentSchema: { type: 'object', properties: {
      requirement: { type: 'string', enum: RECORDABLE_REQUIREMENTS }, summary: { type: 'string', minLength: 1, maxLength: 2000 },
      files: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 500 }, maxItems: 100 }
    }, required: ['requirement', 'summary'], additionalProperties: false },
    execute: (arguments_, context) => {
      if (!context.taskId) throw new ToolFailure(toolError('invalid_request', 'Completion evidence requires a task ID.'));
      const recorded = evidence.record(context.taskId, arguments_.requirement as CompletionRequirement, arguments_.summary as string, arguments_.files as string[] | undefined);
      return { data: recorded, resultCount: 1, source: 'execution' };
    }
  });
  registry.register({
    id: 'get_completion_state', description: 'Return LGS completion gates, evidence, outstanding work, and failure-budget state for the current task.', permission: READ_PERMISSION,
    argumentSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: (_arguments, context) => {
      if (!context.taskId) throw new ToolFailure(toolError('invalid_request', 'Completion state requires a task ID.'));
      const state = guard.evaluate(context.taskId);
      return { data: state, resultCount: state.checklist.length, source: 'execution' };
    }
  });
  return registry;
}

