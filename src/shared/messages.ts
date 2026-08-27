import type { CompletionViewState } from '../completion/types.js';

export type ChatOptions = { mode: 'implementation' | 'planning'; thinking: 'off' | 'low' | 'medium' | 'high'; approval: 'always' | 'on-request' | 'never' };
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
};

export type TaskAction = 'viewDiff' | 'viewLogs' | 'viewResearch' | 'viewTaskState';
export type ClientMessage =
  | { type: 'ready' }
  | { type: 'userMessage'; text: string }
  | { type: 'cancel' }
  | { type: 'selectProfile'; profileId: string }
  | { type: 'selectModel'; model: string }
  | { type: 'setOptions'; options: ChatOptions }
  | { type: 'listModels' }
  | { type: 'newChat' }
  | { type: 'openSettings' }
  | { type: 'openUsage' }
  | { type: 'loadChat'; chatId: string }
  | { type: 'taskAction'; action: TaskAction };

export type HostMessage =
  | { type: 'profiles'; profiles: { id: string; name: string; kind: string }[]; selected: string }
  | { type: 'models'; models: { id: string; displayName?: string }[]; selected: string }
  | { type: 'state'; state: string }
  | { type: 'streamStart'; backend: string; model: string }
  | { type: 'textDelta'; text: string }
  | { type: 'streamEnd' }
  | { type: 'chatList'; chats: { id: string; title: string; updatedAt: number }[] }
  | { type: 'chatLoaded'; messages: { role: 'user' | 'assistant' | 'system'; text: string }[] }
  | { type: 'options'; options: ChatOptions }
  | { type: 'error'; message: string }
  | { type: 'appearance'; theme: 'vscode' | 'lgs-light' | 'lgs-dark' }
  | { type: 'completionState'; state: CompletionViewState }
  | { type: 'taskDashboard'; dashboard: TaskDashboard };

export function parseClientMessage(value: unknown): ClientMessage | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
  const message = value as Record<string, unknown>;
  if (['ready', 'cancel', 'listModels', 'newChat', 'openSettings', 'openUsage'].includes(String(message.type))) return { type: message.type } as ClientMessage;
  if (message.type === 'taskAction' && ['viewDiff', 'viewLogs', 'viewResearch', 'viewTaskState'].includes(String(message.action))) return { type: 'taskAction', action: message.action as TaskAction };
  if (message.type === 'userMessage' && typeof message.text === 'string') {
    const text = message.text.trim(); return text && text.length <= 4000 ? { type: 'userMessage', text } : undefined;
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
    if (['implementation', 'planning'].includes(String(options.mode)) && ['off', 'low', 'medium', 'high'].includes(String(options.thinking)) && ['always', 'on-request', 'never'].includes(String(options.approval))) {
      return { type: 'setOptions', options: { mode: options.mode as ChatOptions['mode'], thinking: options.thinking as ChatOptions['thinking'], approval: options.approval as ChatOptions['approval'] } };
    }
  }
}

export function isHostMessage(value: unknown): value is HostMessage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return ['profiles', 'models', 'state', 'streamStart', 'textDelta', 'streamEnd', 'chatList', 'chatLoaded', 'options', 'error', 'appearance', 'completionState', 'taskDashboard'].includes(String((value as Record<string, unknown>).type));
}
