import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RuntimeVerificationRecord, RuntimeVerificationReader, RuntimeConfiguration, BrowserAcceptanceCheck } from './types.js';
import { ManagedProcessManager } from './processes.js';
import { BrowserSession } from './browser.js';
import { BrowserAgent } from './browser-agent.js';
import type { BrowserConfirmationPrompt } from './types.js';

export class FileRuntimeStore implements RuntimeVerificationReader {
  constructor(private readonly root: string) {}
  append(record: RuntimeVerificationRecord): void { const file = this.file(record.taskId); fs.mkdirSync(path.dirname(file), { recursive: true }); const records = this.read(record.taskId); records.push(record); fs.writeFileSync(file, JSON.stringify(records, null, 2)); }
  latest(taskId: string): RuntimeVerificationRecord | undefined { return this.read(taskId).at(-1); }
  private read(taskId: string): RuntimeVerificationRecord[] { try { const value = JSON.parse(fs.readFileSync(this.file(taskId), 'utf8')); return Array.isArray(value) ? value as RuntimeVerificationRecord[] : []; } catch { return []; } }
  private file(taskId: string): string { return path.join(this.root, '.lgs', 'runtime', 'tasks', `${safe(taskId)}.json`); }
}

export class RuntimeVerifier {
  readonly browser: BrowserSession;
  readonly browserAgent: BrowserAgent;
  constructor(private readonly configuration: RuntimeConfiguration, private readonly processes: ManagedProcessManager, private readonly store: FileRuntimeStore, root: string, confirmation?: BrowserConfirmationPrompt) { this.browser = new BrowserSession(root, configuration); this.browserAgent = new BrowserAgent(root, this.browser, configuration, confirmation); }
  async start(taskId?: string) { if (!this.configuration.start) throw new Error('No runtime.start command is configured.'); return this.processes.start(this.configuration.start, taskId); }
  async verify(taskId: string): Promise<RuntimeVerificationRecord> {
    const checks: RuntimeVerificationRecord['checks'] = []; const artifacts: string[] = []; let processId: string | undefined;
    try {
      if (this.configuration.start) { const process = await this.start(taskId); processId = process.id; if (process.state === 'denied' || process.state === 'crashed') throw new Error(process.stderr.join('\n') || `Runtime process ${process.state}.`); }
      if (this.configuration.healthcheck) { const outcome = await healthcheck(this.configuration.healthcheck); checks.push({ name: 'healthcheck', ...outcome }); if (processId) this.processes.markReady(processId, outcome.status === 'passed'); if (outcome.status !== 'passed') throw new Error(outcome.detail); }
      for (const check of this.configuration.acceptance ?? []) { const outcome = await this.browserCheck(check, artifacts); checks.push(outcome); if (outcome.status !== 'passed') throw new Error(outcome.detail); }
      return this.record(taskId, 'passed', 'Runtime and browser verification passed.', checks, processId, artifacts);
    } catch (error) { return this.record(taskId, 'failed', concise(error), checks.length ? checks : [{ name: 'runtime', status: 'failed', detail: concise(error) }], processId, artifacts); }
  }
  async dispose(): Promise<void> { await this.browser.dispose(); this.processes.dispose(); }
  private async browserCheck(check: BrowserAcceptanceCheck, artifacts: string[]): Promise<{ name: string; status: 'passed' | 'failed'; detail: string }> {
    try {
      if (check.type === 'browser_open') { if (!check.url) throw new Error('browser_open requires url.'); await this.browser.open(check.url); }
      else if (check.type === 'browser_click') { if (!check.selector) throw new Error('browser_click requires selector.'); await this.browser.click(check.selector); }
      else if (check.type === 'browser_type') { if (!check.selector || check.text === undefined) throw new Error('browser_type requires selector and text.'); await this.browser.type(check.selector, check.text); }
      else if (check.type === 'browser_get_text') { if (!check.selector) throw new Error('browser_get_text requires selector.'); const text = await this.browser.getText(check.selector); if (check.expectedText !== undefined && !text.includes(check.expectedText)) throw new Error(`Expected text ${JSON.stringify(check.expectedText)} was not found.`); }
      else if (check.type === 'browser_wait_for') await this.browser.waitFor(check);
      else if (check.type === 'browser_console') { const errors = this.browser.consoleErrors(); if (errors.length > (check.expectedErrors ?? 0)) throw new Error(`${errors.length} browser console error(s): ${errors.map(item => item.message).join('; ')}`); }
      else { const errors = this.browser.networkErrors(); if (errors.length > (check.expectedErrors ?? 0)) throw new Error(`${errors.length} browser network error(s): ${errors.map(item => item.message).join('; ')}`); }
      if (check.type !== 'browser_console' && check.type !== 'browser_network_errors') { const shot = await this.browser.screenshot(); artifacts.push(shot.path); }
      return { name: check.type, status: 'passed', detail: 'Passed.' };
    } catch (error) { return { name: check.type, status: 'failed', detail: concise(error) }; }
  }
  private record(taskId: string, status: 'passed' | 'failed', summary: string, checks: RuntimeVerificationRecord['checks'], processId?: string, artifactPaths: string[] = []): RuntimeVerificationRecord { const record = { id: randomUUID(), taskId, status, createdAt: new Date().toISOString(), summary, processId, checks, artifactPaths }; this.store.append(record); return record; }
}

async function healthcheck(value: NonNullable<RuntimeConfiguration['healthcheck']>): Promise<{ status: 'passed' | 'failed'; detail: string }> {
  const deadline = Date.now() + (value.timeoutMs ?? 30_000); let last = 'No response.';
  while (Date.now() <= deadline) { try { const response = await fetch(value.url, { signal: AbortSignal.timeout(Math.min(5_000, Math.max(1, deadline - Date.now()))) }); if (response.status === value.expectedStatus) return { status: 'passed', detail: `${value.url} returned ${response.status}.` }; last = `${value.url} returned ${response.status}; expected ${value.expectedStatus}.`; } catch (error) { last = concise(error); } await new Promise(resolve => setTimeout(resolve, value.intervalMs ?? 250)); }
  return { status: 'failed', detail: last };
}
function concise(error: unknown): string { const text = error instanceof Error ? error.message : 'Runtime verification failed.'; return text.replace(/\s+/g, ' ').slice(0, 1_000); }
function safe(value: string): string { return value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128) || 'task'; }
