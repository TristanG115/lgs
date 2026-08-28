import { isPlainObject, validateSchema } from './schema.js';
import {
  READ_ONLY_WORKSPACE_PERMISSION, ToolFailure, type ToolAuditRecord, type ToolAuditSink, type ToolCall, type ToolDefinition,
  type ToolError, type ToolExecutionContext, type ToolExecutionGuard, type ToolIdentity, type ToolResult
} from './types.js';

const DEFAULT_MAX_RESULT_BYTES = 64 * 1024;
const MAX_AUDIT_ARGUMENT_BYTES = 8 * 1024;
const SECRET_KEY = /(secret|token|password|authorization|api[-_]?key|cookie)/i;

export class MemoryAuditSink implements ToolAuditSink {
  readonly entries: ToolAuditRecord[] = [];
  record(entry: ToolAuditRecord): void { this.entries.push(entry); }
}

export class ToolRegistry {
  private readonly definitions = new Map<string, ToolDefinition>();

  register<TArguments extends Record<string, unknown>, TData>(definition: ToolDefinition<TArguments, TData>): this {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(definition.id)) throw new Error(`Invalid tool ID: ${definition.id}`);
    if (this.definitions.has(definition.id)) throw new Error(`Duplicate tool ID: ${definition.id}`);
    if (!['workspace', 'computer'].includes(definition.permission.scope)) throw new Error(`Tool ${definition.id} has an invalid scope.`);
    if (definition.permission.access === 'read-only' && definition.permission.network) throw new Error(`Read-only tool ${definition.id} cannot use the network.`);
    this.definitions.set(definition.id, definition as ToolDefinition);
    return this;
  }

  get(id: string): ToolDefinition | undefined { return this.definitions.get(id); }
  list(): ToolDefinition[] { return [...this.definitions.values()]; }
  specifications(): { id: string; description: string; argumentSchema: ToolDefinition['argumentSchema']; permission: ToolDefinition['permission'] }[] {
    return this.list().map(({ id, description, argumentSchema, permission }) => ({ id, description, argumentSchema, permission }));
  }
}

export class ToolExecutor {
  constructor(
    readonly registry: ToolRegistry,
    private readonly workspaceRoot: string,
    private readonly audit?: ToolAuditSink,
    private readonly maxResultBytes = DEFAULT_MAX_RESULT_BYTES,
    private readonly guards: ToolExecutionGuard[] = []
  ) {}

  async execute(rawCall: unknown, identity: ToolIdentity = {}, signal: AbortSignal = new AbortController().signal): Promise<ToolResult> {
    const started = performance.now();
    const parsed = parseToolCall(rawCall);
    const call = parsed.call;
    const raw = isPlainObject(rawCall) ? rawCall : undefined;
    const rawId = typeof raw?.id === 'string' ? raw.id : undefined;
    const auditCall: ToolCall = call ?? { id: rawId?.slice(0, 64) || 'unknown', callId: typeof raw?.callId === 'string' ? raw.callId.slice(0, 128) : undefined, arguments: isPlainObject(raw?.arguments) ? raw.arguments : {} };
    const definition = this.registry.get(call?.id ?? rawId ?? '');
    let result: ToolResult;
    if (parsed.error) result = errorResult(call?.id ?? rawId ?? 'unknown', call?.callId ?? auditCall?.callId, parsed.error, started);
    else if (!definition || !call) result = errorResult(call?.id ?? 'unknown', call?.callId, toolError('unknown_tool', `Unknown tool: ${call?.id ?? 'unknown'}`), started);
    else {
      const issues = validateSchema(definition.argumentSchema, call.arguments);
      if (!issues.length && definition.validate) issues.push(...definition.validate(call.arguments).map(message => ({ path: '$', message })));
      if (issues.length) {
        result = errorResult(definition.id, call.callId, toolError('invalid_request', 'Tool arguments failed validation.', false, { issues }), started);
      } else if ((identity.taskMode === 'plan' || identity.taskMode === 'planning') && !planModeAllows(definition)) result = errorResult(definition.id, call.callId, toolError('unsupported', 'Write blocked by Plan Mode. Only the active plan artifact may be modified while planning.'), started);
      else if (identity.taskMode === 'chat' && definition.permission.access === 'execute' && !researchTool(definition.id)) result = errorResult(definition.id, call.callId, toolError('unsupported', 'Mutating actions are disabled in Chat Mode. Select Implement to change the workspace.'), started);
      else if (identity.taskMode === 'review' && !reviewTool(definition.id)) result = errorResult(definition.id, call.callId, toolError('unsupported', 'This action is disabled in Review Mode.'), started);
      else if (guardMessage(this.guards, definition, identity)) result = errorResult(definition.id, call.callId, toolError('unsupported', guardMessage(this.guards, definition, identity)!), started);
      else if (signal.aborted) result = errorResult(definition.id, call.callId, toolError('cancelled', 'Tool execution was cancelled.'), started, 'cancelled');
      else {
        try {
          const context: ToolExecutionContext = { ...identity, workspaceRoot: this.workspaceRoot, signal };
          const output = await definition.execute(call.arguments, context);
          if (signal.aborted) throw new ToolFailure(toolError('cancelled', 'Tool execution was cancelled.'));
          const bounded = boundData(output.data, this.maxResultBytes);
          const durationMs = elapsed(started);
          result = {
            toolCallId: call.callId, toolId: definition.id, status: 'success', data: bounded.data,
            metadata: {
              durationMs, resultCount: output.resultCount, bytes: bounded.bytes,
              truncated: Boolean(output.truncated) || bounded.truncated,
              continuationToken: output.continuationToken, source: output.source
            }
          };
        } catch (error) {
          const structured = error instanceof ToolFailure ? error.toolError : signal.aborted
            ? toolError('cancelled', 'Tool execution was cancelled.')
            : toolError('execution_failed', error instanceof Error ? error.message : 'Tool execution failed.');
          result = errorResult(definition.id, call.callId, structured, started, structured.code === 'cancelled' ? 'cancelled' : 'error');
        }
      }
    }
    if (definition) await this.writeAudit(definition, auditCall, result, identity);
    else await this.writeUnknownAudit(auditCall, result, identity);
    return result;
  }

  private async writeAudit(definition: ToolDefinition, call: ToolCall, result: ToolResult, identity: ToolIdentity): Promise<void> {
    if (!this.audit) return;
    try {
      const entry: ToolAuditRecord = {
        ...identity, timestamp: new Date().toISOString(), toolCallId: call.callId, toolId: definition.id,
        arguments: auditArguments(call.arguments), permission: definition.permission, status: result.status,
        durationMs: result.metadata.durationMs,
        result: { resultCount: result.metadata.resultCount, bytes: result.metadata.bytes, truncated: result.metadata.truncated, source: result.metadata.source },
        errorCode: result.error?.code
      };
      await this.audit.record(entry);
    } catch { /* Audit failures must not alter a read-only tool result. */ }
  }

  private async writeUnknownAudit(call: ToolCall, result: ToolResult, identity: ToolIdentity): Promise<void> {
    if (!this.audit) return;
    try {
      await this.audit.record({
        ...identity, timestamp: new Date().toISOString(), toolCallId: call.callId, toolId: call.id,
        arguments: auditArguments(call.arguments), permission: READ_ONLY_WORKSPACE_PERMISSION, status: result.status,
        durationMs: result.metadata.durationMs, result: { bytes: result.metadata.bytes, truncated: result.metadata.truncated },
        errorCode: result.error?.code
      });
    } catch { /* Audit failures must not alter the normalized error. */ }
  }
}

function parseToolCall(value: unknown): { call?: ToolCall; error?: ToolError } {
  if (!isPlainObject(value)) return { error: toolError('invalid_request', 'Tool call must be an object.') };
  const allowed = new Set(['callId', 'id', 'arguments']);
  if (Object.keys(value).some(key => !allowed.has(key))) return { error: toolError('invalid_request', 'Tool call contains unknown fields.') };
  if (typeof value.id !== 'string' || !value.id || value.id.length > 64) return { error: toolError('invalid_request', 'Tool call id must be a non-empty string.') };
  if (value.callId !== undefined && (typeof value.callId !== 'string' || value.callId.length > 128)) return { error: toolError('invalid_request', 'Tool call callId must be a string of at most 128 characters.') };
  if (!isPlainObject(value.arguments)) return { error: toolError('invalid_request', 'Tool call arguments must be an object.') };
  return { call: { id: value.id, callId: value.callId as string | undefined, arguments: value.arguments } };
}

function boundData(data: unknown, maximum: number): { data: unknown; bytes: number; truncated: boolean } {
  if (maximum < 4) throw new ToolFailure(toolError('output_limit', 'The configured result limit is too small to encode a normalized result.'));
  let serialized: string;
  try {
    const encoded = JSON.stringify(data) as string | undefined;
    if (encoded === undefined) throw new Error();
    serialized = encoded;
  }
  catch { throw new ToolFailure(toolError('execution_failed', 'Tool result was not JSON serializable.')); }
  const bytes = Buffer.byteLength(serialized);
  if (bytes <= maximum) return { data, bytes, truncated: false };
  let preview = Buffer.from(serialized).subarray(0, Math.max(0, maximum - 128)).toString('utf8');
  let bounded: unknown = { preview, notice: `Result exceeded the ${maximum}-byte framework limit.` };
  let boundedBytes = Buffer.byteLength(JSON.stringify(bounded));
  while (boundedBytes > maximum && preview.length) {
    preview = preview.slice(0, Math.max(0, preview.length - (boundedBytes - maximum) - 1));
    bounded = { preview, notice: `Result exceeded the ${maximum}-byte framework limit.` };
    boundedBytes = Buffer.byteLength(JSON.stringify(bounded));
  }
  if (boundedBytes > maximum) { bounded = null; boundedBytes = 4; }
  return { data: bounded, bytes: boundedBytes, truncated: true };
}

function errorResult(toolId: string, callId: string | undefined, error: ToolError, started: number, status: 'error' | 'cancelled' = 'error'): ToolResult {
  return { toolCallId: callId, toolId, status, error, metadata: { durationMs: elapsed(started), bytes: 0, truncated: false } };
}

function elapsed(started: number): number { return Math.max(0, Math.round((performance.now() - started) * 100) / 100); }
export function planModeAllows(definition: Pick<ToolDefinition, 'id' | 'permission'>): boolean {
  if (definition.permission.access === 'read-only') return true;
  return ['web_search', 'web_fetch', 'documentation_search', 'repository_search', 'create_plan_task', 'revise_plan'].includes(definition.id);
}
function planningTool(id: string): boolean { return id.startsWith('list_') || id.startsWith('get_') || id.startsWith('read_') || id.startsWith('search_') || id.startsWith('find_') || ['web_search', 'web_fetch', 'documentation_search', 'repository_search', 'create_plan_task', 'revise_plan'].includes(id); }
function reviewTool(id: string): boolean { return planningTool(id) || ['run_independent_review', 'evaluate_review_findings'].includes(id); }
function researchTool(id: string): boolean { return ['web_search', 'web_fetch', 'documentation_search', 'repository_search'].includes(id) || id.startsWith('research_'); }
function guardMessage(guards: ToolExecutionGuard[], definition: ToolDefinition, identity: ToolIdentity): string | undefined { for (const guard of guards) { const message = guard.check(definition, identity); if (message) return message; } }
export function toolError(code: ToolError['code'], message: string, retryable = false, details?: Record<string, unknown>): ToolError {
  return { code, message, retryable, details };
}

export function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new ToolFailure(toolError('cancelled', 'Tool execution was cancelled.'));
}

function redactSecrets(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => SECRET_KEY.test(key) ? [] : [[key, redactValue(child)]]));
}
function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (isPlainObject(value)) return redactSecrets(value);
  return value;
}
function auditArguments(value: Record<string, unknown>): Record<string, unknown> {
  const redacted = redactSecrets(value);
  const serialized = JSON.stringify(redacted);
  if (Buffer.byteLength(serialized) <= MAX_AUDIT_ARGUMENT_BYTES) return redacted;
  return { _truncated: true, preview: Buffer.from(serialized).subarray(0, MAX_AUDIT_ARGUMENT_BYTES - 128).toString('utf8') };
}
