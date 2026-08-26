import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import type { RuntimeConfiguration } from './types.js';

export type BrowserEvent = { type: 'console' | 'network'; message: string; url?: string; at: string };
export class BrowserSession {
  private browser?: Browser; private page?: Page; private readonly events: BrowserEvent[] = [];
  constructor(private readonly root: string, private readonly configuration: RuntimeConfiguration) {}
  async open(url: string): Promise<{ url: string; title: string }> { const page = await this.ensurePage(); await page.goto(url, { waitUntil: 'domcontentloaded' }); return { url: page.url(), title: await page.title() }; }
  async click(selector: string): Promise<void> { await (await this.ensurePage()).click(selector); }
  async type(selector: string, text: string): Promise<void> { await (await this.ensurePage()).fill(selector, text); }
  async getText(selector: string): Promise<string> { return (await this.ensurePage()).locator(selector).innerText(); }
  async waitFor(options: { selector?: string; text?: string; timeoutMs?: number }): Promise<void> { const page = await this.ensurePage(); const timeout = options.timeoutMs ?? this.configuration.browser?.timeoutMs ?? 15_000; if (options.selector) await page.locator(options.selector).waitFor({ state: 'visible', timeout }); else if (options.text) await page.getByText(options.text, { exact: false }).waitFor({ state: 'visible', timeout }); else await page.waitForLoadState('networkidle', { timeout }); }
  async screenshot(): Promise<{ path: string }> { const page = await this.ensurePage(); const relative = path.join('.lgs', 'runtime', 'browser', `${randomUUID()}.png`); const target = path.join(this.root, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); await page.screenshot({ path: target, fullPage: true }); return { path: relative }; }
  consoleErrors(): BrowserEvent[] { return this.events.filter(event => event.type === 'console'); }
  networkErrors(): BrowserEvent[] { return this.events.filter(event => event.type === 'network'); }
  async dispose(): Promise<void> { await this.browser?.close(); this.browser = undefined; this.page = undefined; }
  private async ensurePage(): Promise<Page> {
    if (this.page) return this.page;
    this.browser = await chromium.launch({ headless: this.configuration.browser?.headless ?? true }); this.page = await this.browser.newPage();
    this.page.on('console', message => { if (message.type() === 'error') this.events.push({ type: 'console', message: message.text(), at: new Date().toISOString() }); });
    this.page.on('requestfailed', request => this.events.push({ type: 'network', message: request.failure()?.errorText ?? 'Request failed.', url: request.url(), at: new Date().toISOString() }));
    return this.page;
  }
}
