import { ToolFailure, type ToolPermission } from '../tools/types.js';
import { ToolRegistry, toolError } from '../tools/framework.js';
import type { IndependentReviewer } from './reviewer.js';
import type { FileReviewStore } from './store.js';
import type { FindingDisposition } from './types.js';

const REVIEW_PERMISSION: ToolPermission = { access: 'execute', scope: 'workspace', network: false, category: 'process' };
const READ_PERMISSION: ToolPermission = { access: 'read-only', scope: 'workspace', network: false, category: 'read-only' };

export function registerReviewTools(registry: ToolRegistry, reviewer: IndependentReviewer, store: FileReviewStore): ToolRegistry {
  registry.register({
    id: 'run_independent_review', description: 'Create a fresh Reviewer context from the objective, acceptance criteria, current diff, relevant source, tests, verification, research, and documentation evidence. The implementation conversation is never included.', permission: REVIEW_PERMISSION,
    argumentSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async (_arguments, context) => {
      if (!context.taskId) throw new ToolFailure(toolError('invalid_request', 'Independent review requires a task ID.'));
      const review = await reviewer.review(context.taskId, context.signal);
      return { data: review, resultCount: review.findings.length, source: 'review' };
    }
  });
  registry.register({
    id: 'evaluate_review_findings', description: 'Manager-only disposition of every finding from the latest current review. Confirmed issues become remaining task work and require fixes, tests, documentation checks, and a fresh review.', permission: REVIEW_PERMISSION,
    argumentSchema: { type: 'object', properties: {
      reviewId: { type: 'string', minLength: 1, maxLength: 128 }, dispositions: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', properties: {
        findingId: { type: 'string', minLength: 1, maxLength: 128 }, decision: { type: 'string', enum: ['confirmed', 'dismissed'] }, rationale: { type: 'string', minLength: 1, maxLength: 2000 }
      }, required: ['findingId', 'decision', 'rationale'], additionalProperties: false } }
    }, required: ['reviewId', 'dispositions'], additionalProperties: false },
    execute: (arguments_, context) => {
      if (!context.taskId) throw new ToolFailure(toolError('invalid_request', 'Review evaluation requires a task ID.'));
      const review = reviewer.evaluate(context.taskId, arguments_.reviewId as string, arguments_.dispositions as FindingDisposition[]);
      return { data: review, resultCount: review.findings.length, source: 'review' };
    }
  });
  registry.register({
    id: 'get_review_state', description: 'Return the latest structured independent review and whether all of its evidence remains current.', permission: READ_PERMISSION,
    argumentSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: (_arguments, context) => {
      if (!context.taskId) throw new ToolFailure(toolError('invalid_request', 'Review state requires a task ID.'));
      const review = store.latest(context.taskId);
      return { data: { review, current: review ? store.isCurrent(review) : false }, resultCount: review?.findings.length ?? 0, source: 'review' };
    }
  });
  return registry;
}
