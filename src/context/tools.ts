import * as fs from 'node:fs';
import * as path from 'node:path';
import { ToolFailure, type ToolPermission } from '../tools/types.js';
import { ToolRegistry, toolError } from '../tools/framework.js';
import type { RepositoryIndex } from '../intelligence/indexer.js';
import { ContextBroker } from './broker.js';

const READ: ToolPermission = { access: 'read-only', scope: 'workspace', network: false, category: 'read-only' };
export function registerContextTools(registry: ToolRegistry, broker: ContextBroker): ToolRegistry {
  registry.register({ id: 'select_context', description: 'Select deduplicated, retrieval-first repository context under a token budget. It returns hierarchy metadata and exact requested source ranges, never a blind summary.', permission: READ, argumentSchema: { type: 'object', properties: { objective: { type: 'string', minLength: 1, maxLength: 4000 }, tokenBudget: { type: 'integer', minimum: 1, maximum: 100000 }, paths: { type: 'array', maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 1024 } }, symbols: { type: 'array', maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 200 } } }, required: ['objective', 'tokenBudget'], additionalProperties: false }, execute: (args, context) => { const index = loadIndex(context.workspaceRoot); const paths = args.paths as string[] | undefined; const symbols = args.symbols as string[] | undefined; const candidates = broker.repositoryCandidates(context.workspaceRoot, index, { objective: args.objective as string, paths, symbols }); const selection = broker.select({ objective: args.objective as string, tokenBudget: args.tokenBudget as number, candidates, requestedPaths: paths, requestedSymbols: symbols }); return { data: selection, resultCount: selection.selected.length, truncated: selection.omitted.length > 0, source: 'repository-index' }; } });
  return registry;
}
function loadIndex(root: string): RepositoryIndex { try { return JSON.parse(fs.readFileSync(path.join(root, '.lgs', 'index.json'), 'utf8')) as RepositoryIndex; } catch { throw new ToolFailure(toolError('not_found', 'Repository index not found. Run LGS: Rebuild Repository Index.')); } }
