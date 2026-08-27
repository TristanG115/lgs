import type { PermissionPolicy } from '../execution/types.js';

export const COMPUTER_OPERATION_CLASSES = [
  'workspace-execution', 'system-inspection', 'user-filesystem-modification', 'user-software-management',
  'system-software-management', 'elevated-administrator'
] as const;
export type ComputerOperationClass = typeof COMPUTER_OPERATION_CLASSES[number];
export type ExternalAccess = 'read' | 'write';
export type ComputerResultStatus = 'passed' | 'failed' | 'denied' | 'cancelled' | 'timed_out' | 'planned' | 'spawn_error';

export type TrustedLocation = { path: string; read: PermissionPolicy; write: PermissionPolicy };
export type ComputerConfiguration = {
  readOutsideWorkspace: PermissionPolicy;
  writeOutsideWorkspace: PermissionPolicy;
  trustedLocations: TrustedLocation[];
  systemCommandPolicy: PermissionPolicy;
  packageInstallationPolicy: PermissionPolicy;
  elevatedCommandPolicy: PermissionPolicy;
  dryRun: boolean;
  externalDocumentAccess: PermissionPolicy;
  activityLogRetentionDays: number;
};

export type ComputerPermissionDecision = { policy: PermissionPolicy; operation: ComputerOperationClass; source: 'trusted-location' | 'configuration' | 'built-in'; highRisk: boolean };
export type ComputerPermissionPrompt = (request: { operation: ComputerOperationClass; target: string; reason: string; dryRun: boolean }) => Promise<boolean>;

export type ComputerCommandRequest = {
  executable: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  operation: ComputerOperationClass;
  taskId?: string;
  reason: string;
  visible?: boolean;
  dryRun?: boolean;
};
export type ComputerCommandResult = {
  id: string; status: ComputerResultStatus; command: string; operation: ComputerOperationClass; cwd: string;
  exitCode: number | null; stdout: string; stderr: string; startedAt: string; completedAt: string; durationMs: number;
  verification?: string;
};

export type ActivityLedgerEntry = {
  id: string; timestamp: string; taskId?: string; agent?: string; model?: string; provider?: string;
  operation: string; target?: string; reason?: string; permission: PermissionPolicy; result: string; durationMs?: number;
  verification?: string; tokenUsageReference?: string; details?: Record<string, unknown>;
};
export type AgentTrace = {
  taskId: string; agentId: string; model?: string; provider?: string; role?: string; subtask?: string;
  contextCategories: string[]; toolsRequested: string[]; toolsExecuted: string[]; filesAffected: string[];
  researchPerformed: string[]; retries: number; escalations: string[]; result?: string; updatedAt: string;
};
export type DecisionJournalEntry = {
  id: string; timestamp: string; taskId: string; subtask?: string; agent?: string; model?: string;
  decision: string; conclusion: string; evidence: string[]; alternatives?: string[]; rejectedAlternatives?: string[];
  confidence: 'low' | 'medium' | 'high'; repositorySources?: string[]; gitSources?: string[]; externalSources?: string[];
};

export type ExternalFileContent = {
  path: string; format: 'text' | 'markdown' | 'json' | 'csv' | 'pdf' | 'docx' | 'xlsx' | 'image' | 'source' | 'unknown';
  text?: string; structured?: unknown; metadata: Record<string, unknown>; truncated: boolean;
};
