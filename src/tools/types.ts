export type JsonSchema =
  | { type: 'string'; description?: string; enum?: string[]; minLength?: number; maxLength?: number; pattern?: string }
  | { type: 'integer'; description?: string; minimum?: number; maximum?: number }
  | { type: 'boolean'; description?: string }
  | { type: 'array'; description?: string; items: JsonSchema; minItems?: number; maxItems?: number }
  | { type: 'object'; description?: string; properties: Record<string, JsonSchema>; required?: string[]; additionalProperties?: boolean };

export type ToolPermission = {
  access: 'read-only' | 'execute';
  scope: 'workspace';
  network: boolean;
  category?: import('../execution/types.js').CommandCategory;
};

export type ToolErrorCode =
  | 'invalid_request'
  | 'unknown_tool'
  | 'invalid_path'
  | 'not_found'
  | 'not_file'
  | 'binary_file'
  | 'output_limit'
  | 'cancelled'
  | 'execution_failed'
  | 'unsupported';

export type ToolError = {
  code: ToolErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

export type ToolResultMetadata = {
  durationMs: number;
  resultCount?: number;
  bytes: number;
  truncated: boolean;
  continuationToken?: string;
  source?: 'repository-index' | 'codebase-map' | 'filesystem' | 'git' | 'execution' | 'research' | 'documentation' | 'review';
};

export type ToolResult<T = unknown> = {
  toolCallId?: string;
  toolId: string;
  status: 'success' | 'error' | 'cancelled';
  data?: T;
  error?: ToolError;
  metadata: ToolResultMetadata;
};

export type ToolIdentity = {
  taskId?: string;
  sessionId?: string;
  agentId?: string;
  model?: string;
};

export type ToolAuditRecord = ToolIdentity & {
  timestamp: string;
  toolCallId?: string;
  toolId: string;
  arguments: Record<string, unknown>;
  permission: ToolPermission;
  status: ToolResult['status'];
  durationMs: number;
  result: Pick<ToolResultMetadata, 'resultCount' | 'bytes' | 'truncated' | 'source'>;
  errorCode?: ToolErrorCode;
};

export interface ToolAuditSink {
  record(entry: ToolAuditRecord): void | Promise<void>;
}

export type ToolExecutionContext = ToolIdentity & {
  workspaceRoot: string;
  signal: AbortSignal;
};

export type ToolExecutionOutput<T> = {
  data: T;
  resultCount?: number;
  truncated?: boolean;
  continuationToken?: string;
  source?: ToolResultMetadata['source'];
};

export type ToolDefinition<TArguments extends Record<string, unknown> = Record<string, unknown>, TData = unknown> = {
  id: string;
  description: string;
  argumentSchema: Extract<JsonSchema, { type: 'object' }>;
  permission: ToolPermission;
  validate?: (arguments_: TArguments) => string[];
  execute: (arguments_: TArguments, context: ToolExecutionContext) => Promise<ToolExecutionOutput<TData>> | ToolExecutionOutput<TData>;
};

export type ToolCall = {
  callId?: string;
  id: string;
  arguments: Record<string, unknown>;
};

export const READ_ONLY_WORKSPACE_PERMISSION: ToolPermission = {
  access: 'read-only', scope: 'workspace', network: false
};

export class ToolFailure extends Error {
  constructor(readonly toolError: ToolError) {
    super(toolError.message);
    this.name = 'ToolFailure';
  }
}
