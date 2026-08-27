/* global window, MessageEvent, document */
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const browser = await chromium.launch({ headless: true });
try {
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
page.setDefaultTimeout(5_000);
await page.addInitScript(() => {
  globalThis.__messages = [];
  globalThis.acquireVsCodeApi = () => ({ postMessage: message => globalThis.__messages.push(message), getState: () => undefined, setState: () => {} });
});
await page.setContent('<!doctype html><html><body><div id="app"></div></body></html>');
await page.evaluate(() => {
  globalThis.__messages = [];
  globalThis.acquireVsCodeApi = () => ({ postMessage: message => globalThis.__messages.push(message), getState: () => undefined, setState: () => {} });
});
await page.addStyleTag({ path: path.join(root, 'dist', 'settings.css') });
await page.addScriptTag({ path: path.join(root, 'dist', 'settings.js') });

const setting = (id, value, source = 'built-in') => ({ id, value, source, scope: 'both', category: id.startsWith('computer.') ? 'Computer Access' : id.startsWith('models.') ? 'Models & Providers' : 'Appearance', label: id, description: id, type: id === 'computer.dryRun' ? 'boolean' : id === 'computer.activityLogRetentionDays' ? 'number' : id.startsWith('computer.') ? 'select' : 'string', choices: id.startsWith('computer.') ? [{ value: 'ask', label: 'Ask each time' }, { value: 'deny', label: 'Deny' }] : undefined });
const statistics = { totalRequests: 2, successfulRequests: 1, failedRequests: 1, cancelledRequests: 0, successRate: .5, inputTokens: 100, outputTokens: 50, cachedTokens: 10, reasoningTokens: 0, totalTokens: 150, activeGenerationMs: 900, averageLatencyMs: 1000, peakLatencyMs: 1200, tasksServed: 1, agentInvocations: 1, mostUsedModel: 'model-a' };
const baseState = {
  type: 'state', errors: [], workspaceOpen: true,
  settings: [
    { ...setting('appearance.theme', 'vscode'), type: 'select', choices: [{ value: 'vscode', label: 'Follow VS Code' }, { value: 'lgs-light', label: 'Research Paper / Light' }, { value: 'lgs-dark', label: 'Research Lab / Dark' }] },
    setting('models.defaultConnection', ''), setting('models.defaultModel', ''), setting('computer.readOutsideWorkspace', 'ask'), setting('computer.dryRun', true), setting('computer.activityLogRetentionDays', 90),
  ],
  connections: [],
};
const dispatch = message => page.evaluate(value => window.dispatchEvent(new MessageEvent('message', { data: value })), message);
await dispatch(baseState);
await page.locator('[data-theme="lgs-light"]').click();
assert.equal(await page.evaluate(() => document.documentElement.dataset.lgsTheme), 'lgs-light');
assert.deepEqual((await page.evaluate(() => globalThis.__messages)).at(-1), { type: 'setAppearance', theme: 'lgs-light', scope: 'user' });

await page.locator('[data-nav="providers"]').click();
await page.locator('#add-connection').click();
await page.locator('[name="name"]').fill('Local Beast');
await page.locator('[name="kind"]').selectOption('ollama');
assert.equal(await page.locator('.credential').evaluate(node => node.classList.contains('hidden')), true);
await page.locator('#test-draft').click();
assert.equal((await page.evaluate(() => globalThis.__messages)).at(-1).type, 'testDraftConnection');
await dispatch({ type: 'connectionResult', id: 'draft', draft: true, result: { ok: false, state: 'offline', title: 'Unable to connect to Local Beast', endpoint: 'http://localhost:11434', summary: 'Connection refused.', guidance: 'Ollama may not be running.', models: [], durationMs: 8, checkedAt: new Date().toISOString(), checks: [{ name: 'reachability', result: 'failed', detail: 'Connection refused.' }] } });
assert.equal(await page.locator('#save-connection').isDisabled(), true);
await page.locator('#allow-offline').check();
assert.equal(await page.locator('#save-connection').isEnabled(), true);
await page.locator('#close-editor').click();

const connection = { id: 'gateway', name: 'Purdue GenAI', kind: 'openai-compatible', baseUrl: 'https://gateway.example/v1', enabled: true, headers: {}, secretHeaderNames: ['X-Secret'], discoveryMode: 'automatic', manualModels: [], modelAliases: {}, capabilityOverrides: {}, contextOverrides: {}, pricing: { billing: 'institution_provided' }, dataPolicy: 'repository_allowed', hasApiKey: true, status: { state: 'online', checkedAt: new Date().toISOString(), lastSuccessfulAt: new Date().toISOString(), message: '1 model discovered.', modelCount: 1 }, models: [{ id: 'model-a', contextWindow: 128000, capabilities: { reasoning: true, toolCalling: true } }], statistics, activities: [{ id: 'event', connectionId: 'gateway', timestamp: new Date().toISOString(), type: 'connection', operation: 'connection test', result: 'success', message: '1 model discovered.', raw: '{"Authorization":"[REDACTED]"}' }] };
await dispatch({ ...baseState, connections: [connection] });
await page.locator('[data-logs="gateway"]').click();
assert.match(await page.locator('.logs-dialog').innerText(), /Purdue GenAI activity/);
assert.match(await page.locator('.logs-dialog').innerText(), /Institution-provided/);
await page.locator('#close-logs').click();
await page.locator('.page-header .restart > summary').click();
await page.locator('.page-header [data-lifecycle="restartServices"]').click();
assert.equal((await page.evaluate(() => globalThis.__messages)).at(-1).action, 'restartServices');

await page.setViewportSize({ width: 520, height: 800 });
const responsive = await page.evaluate(() => { const nav = document.querySelector('.rail nav'); return { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, navigationScrolls: nav.scrollWidth > nav.clientWidth, overflowX: getComputedStyle(nav).overflowX }; });
assert.deepEqual(responsive, { scrollWidth: responsive.clientWidth, clientWidth: responsive.clientWidth, navigationScrolls: true, overflowX: 'auto' });
console.log('Settings browser flows passed.');
} finally {
  await browser.close();
}
