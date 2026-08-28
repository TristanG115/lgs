import type { CompletionViewState } from '../completion/types.js';
import type { ContextLifecycleState } from '../context/types.js';
import type { PlanningArtifact } from '../planning/types.js';
import type { AutoResearchMode, ResearchNotebook } from '../research/types.js';
import type { ActivityEvent, ContextUsage, ExecutionMode, RequestExecution } from '../interaction/types.js';

export type ChatOptions = { mode: ExecutionMode; thinking: 'auto' | 'low' | 'medium' | 'high'; autoResearch: AutoResearchMode; capabilities: { web: boolean; code: boolean; terminal: boolean; browser: boolean; computer: boolean; integrations: boolean }; approval: 'always' | 'on-request' | 'never' };
export type ComposerAttachment = { id: string; name: string; mediaType: string; bytes: number; dataBase64: string; source: 'composer' | 'clipboard' | 'drop' | 'screenshot' };
export type TaskActivity = { label: string; detail: string; status: 'active' | 'completed' | 'warning'; at: string };
export type TaskDashboard = {
  taskId: string;
  objective: string;
  acceptanceCriteria: string[];
  plan: string[];
  completed: string[];
  remaining: string[];
  files: string[];
  completion?: CompletionViewState;
  advisor: { profile: string; model: string };
  agents: { role: string; model: string; profile: string; state: string }[];
  activities: TaskActivity[];
  usage: { context: number; contextMaximum?: number; tokens: number; tokensPerSecond?: number; cost?: number };
  git: { modified: number; commit?: string };
  review: { findings: number; status?: string };
  researchCount: number;
  planArtifact?: PlanningArtifact;
  research?: ResearchNotebook;
  contextLifecycle?: ContextLifecycleState;
  usageDetails?: { searches: number; rotations: number; compactionSaved: number; byAgent: { agent: string; tokens: number; cost?: number }[] };
};

export type TaskAction = 'viewDiff' | 'viewLogs' | 'viewResearch' | 'viewTaskState' | 'viewPlan' | 'editPlan' | 'approvePlan' | 'regeneratePlan' | 'beginImplementation';
export type ClientMessage =
  | { type: 'ready' }
  | { type: 'userMessage'; text: string; attachments?: ComposerAttachment[] }
  | { type: 'cancel' }
  | { type: 'selectProfile'; profileId: string }
  | { type: 'selectModel'; model: string }
  | { type: 'setOptions'; options: ChatOptions }
  | { type: 'listModels' }
  | { type: 'newChat' }
  | { type: 'openSettings' }
  | { type: 'openUsage' }
  | { type: 'openActivity' }
  | { type: 'openResource'; path: string; line?: number }
  | { type: 'providerAction'; action: 'start' | 'restart' | 'refresh' | 'settings' | 'logs' }
  | { type: 'loadChat'; chatId: string }
  | { type: 'taskAction'; action: TaskAction };

export type HostMessage =
  | { type: 'profiles'; profiles: { id: string; name: string; kind: string }[]; selected: string }
  | { type: 'models'; models: { id: string; displayName?: string; reasoning?: boolean; vision?: boolean; contextWindow?: number }[]; selected: string }
  | { type: 'state'; state: string }
  | { type: 'streamStart'; backend: string; model: string }
  | { type: 'textDelta'; text: string }
  | { type: 'streamEnd' }
  | { type: 'chatList'; chats: { id: string; title: string; updatedAt: number }[] }
  | { type: 'chatLoaded'; messages: { role: 'user' | 'assistant' | 'system'; text: string; attachments?: { name: string; mediaType: string; bytes: number }[] }[] }
  | { type: 'options'; options: ChatOptions }
  | { type: 'error'; message: string }
  | { type: 'appearance'; theme: 'vscode' | 'lgs-light' | 'lgs-dark' }
  | { type: 'completionState'; state: CompletionViewState }
  | { type: 'taskDashboard'; dashboard: TaskDashboard }
  | { type: 'requestExecution'; request: RequestExecution; events: ActivityEvent[] }
  | { type: 'contextUsage'; usage: ContextUsage }
  | { type: 'providerNotice'; provider: string; state: 'offline' | 'starting' | 'running' | 'error'; message?: string; ownership?: 'none' | 'external' | 'lgs-managed'; canStart: boolean; canRestart: boolean };

export function parseClientMessage(value: unknown): ClientMessage | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
  const message = value as Record<string, unknown>;
  if (['ready', 'cancel', 'listModels', 'newChat', 'openSettings', 'openUsage', 'openActivity'].includes(String(message.type))) return { type: message.type } as ClientMessage;
  if (message.type === 'openResource' && typeof message.path === 'string' && message.path.length <= 4096 && (message.line === undefined || Number.isInteger(message.line) && Number(message.line) > 0)) return { type: 'openResource', path: message.path, ...(message.line ? { line: Number(message.line) } : {}) };
  if (message.type === 'providerAction' && ['start', 'restart', 'refresh', 'settings', 'logs'].includes(String(message.action))) return { type: 'providerAction', action: message.action as Extract<ClientMessage, { type: 'providerAction' }>['action'] };
  if (message.type === 'taskAction' && ['viewDiff', 'viewLogs', 'viewResearch', 'viewTaskState', 'viewPlan', 'editPlan', 'approvePlan', 'regeneratePlan', 'beginImplementation'].includes(String(message.action))) return { type: 'taskAction', action: message.action as TaskAction };
  if (message.type === 'userMessage' && typeof message.text === 'string') {
    const text = message.text.trim(); const attachments = parseAttachments(message.attachments); return text && text.length <= 4000 && attachments !== undefined ? { type: 'userMessage', text, ...(attachments.length ? { attachments } : {}) } : undefined;
  }
  if (message.type === 'selectProfile' || message.type === 'selectModel' || message.type === 'loadChat') {
    const key = message.type === 'selectProfile' ? 'profileId' : message.type === 'selectModel' ? 'model' : 'chatId';
    if (typeof message[key] !== 'string') return;
    return message.type === 'selectProfile' ? { type: 'selectProfile', profileId: message[key] as string }
      : message.type === 'selectModel' ? { type: 'selectModel', model: message[key] as string }
      : { type: 'loadChat', chatId: message[key] as string };
  }
  if (message.type === 'setOptions' && typeof message.options === 'object' && message.options !== null) {
    const options = message.options as Record<string, unknown>;
    const capabilities = options.capabilities;
    if (['normal', 'plan', 'web', 'research'].includes(String(options.mode)) && ['auto', 'low', 'medium', 'high'].includes(String(options.thinking)) && ['off', 'when-uncertain', 'proactive'].includes(String(options.autoResearch)) && validCapabilities(capabilities) && ['always', 'on-request', 'never'].includes(String(options.approval))) {
      return { type: 'setOptions', options: { mode: options.mode as ChatOptions['mode'], thinking: options.thinking as ChatOptions['thinking'], autoResearch: options.autoResearch as AutoResearchMode, capabilities: capabilities as ChatOptions['capabilities'], approval: options.approval as ChatOptions['approval'] } };
    }
  }
}

function validCapabilities(value: unknown): boolean { if (typeof value !== 'object' || value === null || Array.isArray(value)) return false; const candidate = value as Record<string, unknown>; return ['web', 'code', 'terminal', 'browser', 'computer', 'integrations'].every(key => typeof candidate[key] === 'boolean'); }
function parseAttachments(value: unknown): ComposerAttachment[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) return;
  const parsed: ComposerAttachment[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return; const candidate = item as Record<string, unknown>;
    if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string' || typeof candidate.mediaType !== 'string' || !Number.isInteger(candidate.bytes) || Number(candidate.bytes) < 1 || Number(candidate.bytes) > 25 * 1024 * 1024 || typeof candidate.dataBase64 !== 'string' || candidate.dataBase64.length > 35_000_000 || !['composer', 'clipboard', 'drop', 'screenshot'].includes(String(candidate.source))) return;
    parsed.push(candidate as ComposerAttachment);
  }
  return parsed;
}

export function isHostMessage(value: unknown): value is HostMessage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return ['profiles', 'models', 'state', 'streamStart', 'textDelta', 'streamEnd', 'chatList', 'chatLoaded', 'options', 'error', 'appearance', 'completionState', 'taskDashboard', 'requestExecution', 'contextUsage', 'providerNotice'].includes(String((value as Record<string, unknown>).type));
}
