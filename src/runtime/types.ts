import type { CommandDefinition } from '../execution/types.js';

export type RuntimeStartConfiguration = Omit<CommandDefinition, 'category' | 'include' | 'executable'> & { command: string };
export type RuntimeHealthcheck = { url: string; expectedStatus: number; timeoutMs?: number; intervalMs?: number };
export type BrowserAcceptanceCheck = {
  type: 'browser_open' | 'browser_click' | 'browser_type' | 'browser_get_text' | 'browser_wait_for' | 'browser_console' | 'browser_network_errors';
  url?: string; selector?: string; text?: string; expectedText?: string; timeoutMs?: number; expectedErrors?: number;
};
export type RuntimeConfiguration = { start?: RuntimeStartConfiguration; healthcheck?: RuntimeHealthcheck; acceptance?: BrowserAcceptanceCheck[]; browser?: { headless?: boolean; timeoutMs?: number } };
export type ManagedProcessState = 'starting' | 'running' | 'ready' | 'exited' | 'crashed' | 'stopped' | 'denied';
export type ManagedProcessRecord = {
  id: string; pid?: number; command: string; args: string[]; taskId?: string; state: ManagedProcessState; readiness: 'unknown' | 'ready' | 'not_ready';
  startedAt: string; updatedAt: string; exitedAt?: string; exitCode?: number | null; signal?: NodeJS.Signals | null; outputPath: string; stdout: string[]; stderr: string[]; lgsStarted: true;
};
export type RuntimeVerificationRecord = { id: string; taskId: string; status: 'passed' | 'failed'; createdAt: string; summary: string; processId?: string; checks: { name: string; status: 'passed' | 'failed'; detail: string }[]; artifactPaths: string[] };
export interface RuntimeVerificationReader { latest(taskId: string): RuntimeVerificationRecord | undefined; }
