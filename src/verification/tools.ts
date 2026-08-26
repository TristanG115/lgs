import { ToolRegistry, toolError } from '../tools/framework.js';
import { ToolFailure, type ToolPermission } from '../tools/types.js';
import type { RawExecutionLogStore } from '../execution/logs.js';
import { VERIFICATION_STEPS, type VerificationStep } from './config.js';
import type { VerificationRunner } from './runner.js';

const EXECUTION_PERMISSION: ToolPermission = { access: 'execute', scope: 'workspace', network: true, category: 'process' };
const LOG_PERMISSION: ToolPermission = { access: 'read-only', scope: 'workspace', network: false, category: 'read-only' };

export function registerVerificationTools(registry: ToolRegistry, runner: VerificationRunner, logs: RawExecutionLogStore): ToolRegistry {
  registry.register({
    id: 'run_verification', description: 'Run a named, workspace-configured verification command using structured process execution. Use targetedTest with changed workspace-relative paths during development and full steps before completion.',
    permission: EXECUTION_PERMISSION,
    argumentSchema: { type: 'object', properties: {
      step: { type: 'string', enum: [...VERIFICATION_STEPS] }, targets: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 500 }, maxItems: 100 }
    }, required: ['step'], additionalProperties: false },
    execute: async (arguments_: Record<string, unknown>, context) => {
      const run = await runner.run(arguments_.step as VerificationStep, { targets: arguments_.targets as string[] | undefined, taskId: context.taskId, signal: context.signal });
      return { data: run, resultCount: run.executions.length, source: 'execution' };
    }
  });
  registry.register({
    id: 'get_execution_log', description: 'Retrieve an explicit bounded page from a raw stdout or stderr execution log.', permission: LOG_PERMISSION,
    argumentSchema: { type: 'object', properties: {
      logId: { type: 'string', minLength: 1, maxLength: 128 }, stream: { type: 'string', enum: ['stdout', 'stderr'] },
      offset: { type: 'integer', minimum: 0 }, maxLines: { type: 'integer', minimum: 1, maximum: 400 }
    }, required: ['logId', 'stream'], additionalProperties: false },
    execute: arguments_ => {
      const page = logs.page(arguments_.logId as string, arguments_.stream as 'stdout' | 'stderr', arguments_.offset as number | undefined, arguments_.maxLines as number | undefined);
      if (!page) throw new ToolFailure(toolError('not_found', 'Execution log was not found.'));
      return { data: page, resultCount: page.lines.length, truncated: page.nextOffset !== undefined, continuationToken: page.nextOffset === undefined ? undefined : String(page.nextOffset), source: 'execution' };
    }
  });
  return registry;
}
