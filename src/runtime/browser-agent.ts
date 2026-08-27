import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BrowserSession } from './browser.js';
import type { BrowserAction, BrowserAgentRecord, BrowserConfirmationPrompt, RuntimeConfiguration } from './types.js';

const CONSEQUENTIAL = /\b(?:submit|send|purchase|buy|checkout|order|delete|remove|publish|post|transfer|confirm|accept|sign|upload|save|apply)\b/i;
const SENSITIVE_INPUT = /\b(?:password|card|payment|ssn|social.security|secret|token|credential)\b/i;

/** Reusable Playwright agent for localhost and external sites. Consequential external actions are policy gated and auditable. */
export class BrowserAgent {
  private currentUrl?: string;
  constructor(private readonly workspaceRoot: string, private readonly session: BrowserSession, private readonly configuration: RuntimeConfiguration, private readonly prompt?: BrowserConfirmationPrompt) {}
  async open(url: string, taskId?: string): Promise<{ url: string; title: string }> { const normalized = safeUrl(url); if (this.configuration.browser?.externalSites === false && !local(normalized)) throw new Error('External browser sites are disabled by runtime.browser.externalSites.'); const result = await this.run({ kind: 'navigate', description: `Open ${normalized.toString()}`, url: normalized.toString() }, taskId, () => this.session.open(normalized.toString())); this.currentUrl = result.url; return result; }
  async click(selector: string, taskId?: string, consequential = false): Promise<void> { const kind = consequential || external(this.currentUrl) && CONSEQUENTIAL.test(selector) ? 'consequential' : 'input'; await this.run({ kind, description: `Click ${selector}`, url: this.currentUrl, selector }, taskId, () => this.session.click(selector)); }
  async type(selector: string, text: string, taskId?: string, consequential = false): Promise<void> { const kind = consequential || external(this.currentUrl) && SENSITIVE_INPUT.test(selector) ? 'consequential' : 'input'; await this.run({ kind, description: `Fill ${selector}`, url: this.currentUrl, selector }, taskId, () => this.session.type(selector, text), `Filled ${selector} with ${text.length} character(s).`); }
  async getText(selector: string, taskId?: string): Promise<string> { return this.run({ kind: 'observe', description: `Read ${selector}`, url: this.currentUrl, selector }, taskId, () => this.session.getText(selector)); }
  records(taskId?: string): BrowserAgentRecord[] { try { const value = JSON.parse(fs.readFileSync(this.file(), 'utf8')) as BrowserAgentRecord[]; return Array.isArray(value) ? value.filter(item => !taskId || item.taskId === taskId) : []; } catch { return []; } }
  private async run<T>(action: BrowserAction, taskId: string | undefined, operation: () => Promise<T>, successDetail = 'Passed.'): Promise<T> {
    const policy = action.kind === 'consequential' ? this.configuration.browser?.consequentialActions ?? 'ask' : 'always_allow';
    if (policy === 'deny' || policy === 'ask' && !await this.prompt?.(action)) { this.record({ ...action, id: randomUUID(), taskId, status: 'denied', createdAt: new Date().toISOString(), detail: 'Confirmation was not granted.' }); throw new Error('Browser action denied: consequential actions require confirmation.'); }
    try { const result = await operation(); this.record({ ...action, id: randomUUID(), taskId, status: 'passed', createdAt: new Date().toISOString(), detail: successDetail }); return result; }
    catch (error) { this.record({ ...action, id: randomUUID(), taskId, status: 'failed', createdAt: new Date().toISOString(), detail: error instanceof Error ? error.message.slice(0, 1_000) : 'Browser action failed.' }); throw error; }
  }
  private file(): string { return path.join(this.workspaceRoot, '.lgs', 'browser-agent.json'); }
  private record(value: BrowserAgentRecord): void { const entries = this.records(); entries.push(value); const file = this.file(); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(entries.slice(-1000), null, 2) + '\n'); }
}
function safeUrl(value: string): URL { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('BrowserAgent accepts credential-free HTTP(S) URLs only.'); return url; }
function local(url: URL): boolean { return ['localhost', '127.0.0.1', '::1'].includes(url.hostname); }
function external(value: string | undefined): boolean { if (!value) return false; try { return !local(new URL(value)); } catch { return false; } }
