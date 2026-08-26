export const COMMAND_CATEGORIES = [
  'read-only', 'build', 'test', 'package-manager', 'git-mutation', 'network', 'process', 'dangerous'
] as const;

export type CommandCategory = typeof COMMAND_CATEGORIES[number];
export type PermissionPolicy = 'always_allow' | 'ask' | 'deny';

export type CommandDefinition = {
  executable: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  category: CommandCategory;
  include?: string[];
};

export type ExecutionRequest = Omit<CommandDefinition, 'include'> & {
  taskId?: string;
  verificationStep?: string;
};

export type PermissionConfiguration = {
  default?: PermissionPolicy;
  categories?: Partial<Record<CommandCategory, PermissionPolicy>>;
  executables?: Record<string, PermissionPolicy>;
};

export type PermissionResolution = {
  policy: PermissionPolicy;
  source: 'built-in' | 'user' | 'workspace';
};

export type ExecutionStatus = 'passed' | 'failed' | 'cancelled' | 'timed_out' | 'denied' | 'spawn_error';

export type NormalizedCommandOutput = {
  command: string;
  exitCode: number | null;
  primaryError?: string;
  relevantStack: string[];
  fileLocations: string[];
  stdout: string[];
  stderr: string[];
  omittedLineCount: number;
};

export type ExecutionResult = {
  id: string;
  request: Omit<ExecutionRequest, 'env'> & { envKeys: string[] };
  status: ExecutionStatus;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  rawLogId?: string;
  normalized: NormalizedCommandOutput;
};

export type ExecutionEvidence = {
  kind: 'command-execution';
  recordedAt: string;
  taskId: string;
  verificationStep?: string;
  execution: ExecutionResult;
};

export type PermissionPrompt = (request: ExecutionRequest) => Promise<boolean>;

