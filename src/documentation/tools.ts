import { ToolFailure, type ToolPermission } from '../tools/types.js';
import { ToolRegistry, toolError } from '../tools/framework.js';
import type { DocumentationAgent } from './agent.js';
import type { FileDocumentationAuditStore } from './store.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { writeRepositoryIndex, type RepositoryIndex } from '../intelligence/indexer.js';

const AUDIT_PERMISSION: ToolPermission = { access: 'execute', scope: 'workspace', network: false, category: 'process' };
const READ_PERMISSION: ToolPermission = { access: 'read-only', scope: 'workspace', network: false, category: 'read-only' };

export function registerDocumentationTools(registry: ToolRegistry, agent: DocumentationAgent, store: FileDocumentationAuditStore): ToolRegistry {
  registry.register({
    id: 'audit_documentation', description: 'Run the DocumentationAgent after meaningful modifications. It receives the objective, acceptance criteria, diff, changed symbols, repository relationships, current documentation, CODEBASE_MAP, and task state, then identifies stale documentation by category.', permission: AUDIT_PERMISSION,
    argumentSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async (_arguments, context) => {
      if (!context.taskId) throw new ToolFailure(toolError('invalid_request', 'Documentation audit requires a task ID.'));
      const audit = await agent.audit(context.taskId, context.signal);
      return { data: audit, resultCount: audit.assessments.length, source: 'documentation' };
    }
  });
  registry.register({
    id: 'update_codebase_map', description: 'Incrementally update Repository Intelligence and CODEBASE_MAP after relevant file, responsibility, dependency, interface, test, or architecture changes. Unchanged index entries are reused.', permission: AUDIT_PERMISSION,
    argumentSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: (_arguments, context) => {
      let previous: RepositoryIndex | undefined;
      try { previous = JSON.parse(fs.readFileSync(path.join(context.workspaceRoot, '.lgs', 'index.json'), 'utf8')) as RepositoryIndex; } catch { /* First index build. */ }
      const index = writeRepositoryIndex(context.workspaceRoot, previous);
      return { data: { generatedAt: index.generatedAt, freshness: index.freshness, incremental: index.incremental }, resultCount: index.files.length, source: 'codebase-map' };
    }
  });
  registry.register({
    id: 'get_documentation_state', description: 'Return the latest DocumentationAgent audit and whether its mechanically fingerprinted context is still current.', permission: READ_PERMISSION,
    argumentSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: (_arguments, context) => {
      if (!context.taskId) throw new ToolFailure(toolError('invalid_request', 'Documentation state requires a task ID.'));
      const audit = store.read(context.taskId);
      return { data: { audit, current: audit ? store.isCurrent(audit) : false }, resultCount: audit ? audit.assessments.length : 0, source: 'documentation' };
    }
  });
  return registry;
}
