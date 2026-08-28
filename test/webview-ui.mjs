/* global window, MessageEvent, document */
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..'); const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 760 } });
  await page.addInitScript(() => { globalThis.__messages = []; globalThis.acquireVsCodeApi = () => ({ postMessage: message => globalThis.__messages.push(message) }); });
  await page.setContent('<!doctype html><html><body><div id="app"></div></body></html>');
  await page.evaluate(() => { globalThis.__messages = []; globalThis.acquireVsCodeApi = () => ({ postMessage: message => globalThis.__messages.push(message) }); });
  await page.addStyleTag({ path: path.join(root, 'dist', 'webview.css') }); await page.addScriptTag({ path: path.join(root, 'dist', 'webview.js') });
  const dispatch = message => page.evaluate(value => window.dispatchEvent(new MessageEvent('message', { data: value })), message);
  await dispatch({ type: 'appearance', theme: 'lgs-light' }); await dispatch({ type: 'profiles', profiles: [{ id: 'local', name: 'Local Ollama', kind: 'ollama' }], selected: 'local' });
  await dispatch({ type: 'models', models: [{ id: 'qwen3:8b', displayName: 'Qwen 3 8B', reasoning: true, contextWindow: 128000 }], selected: 'qwen3:8b' });
  await dispatch({ type: 'options', options: { mode: 'research', thinking: 'medium', autoResearch: 'proactive', capabilities: { web: true, code: true, terminal: true, browser: true, computer: false, integrations: true }, approval: 'on-request' } });
  await dispatch({ type: 'contextUsage', usage: { used: 32481, maximum: 128000, unit: 'tokens', estimated: false, categories: { conversation: 12000, repository: 15000, attachments: 5481 } } });
  await dispatch({ type: 'chatLoaded', messages: [{ role: 'user', text: 'Inspect the provider lifecycle and make startup reliable.', attachments: [{ name: 'startup-log.txt', mediaType: 'text/plain', bytes: 4820 }] }, { role: 'assistant', text: 'I found an ownership ambiguity and am updating the managed runtime boundary.' }] });
  const startedAt = new Date(Date.now() - 268000).toISOString(); await dispatch({ type: 'requestExecution', request: { id: 'request-ui', objective: 'Reliable startup', mode: 'research', status: 'active', startedAt, phases: [{ id: 'understand', name: 'Understand request', goal: 'Establish requested behavior and constraints', profileId: 'manager', status: 'completed', startedAt, endedAt: new Date(Date.now() - 250000).toISOString() }, { id: 'inspect', name: 'Inspect system', goal: 'Locate provider and UI architecture', profileId: 'researcher', status: 'completed', startedAt: new Date(Date.now() - 250000).toISOString(), endedAt: new Date(Date.now() - 205000).toISOString() }, { id: 'implement', name: 'Implement', goal: 'Build owned startup and command surface', profileId: 'backend', status: 'active', startedAt: new Date(Date.now() - 205000).toISOString() }, { id: 'verify', name: 'Verify', goal: 'Test runtime and rendered states', profileId: 'verifier', status: 'pending' }] }, events: [{ id: 'e1', requestId: 'request-ui', phaseId: 'implement', timestamp: new Date().toISOString(), type: 'file', summary: 'Edited src/model/ollama-runtime.ts', status: 'success', resource: { kind: 'file', value: 'src/model/ollama-runtime.ts' } }] });
  await page.locator('#details-toggle').click(); assert.match(await page.locator('#request-status').innerText(), /Open activity log/); assert.match(await page.locator('.message-context').innerText(), /startup-log.txt/); assert.equal(await page.locator('#thinking').isVisible(), true);
  for (const width of [240, 360, 680]) { await page.setViewportSize({ width, height: 760 }); const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth })); assert.equal(dimensions.scroll, dimensions.client); }
  await page.setViewportSize({ width: 360, height: 760 }); await page.screenshot({ path: '/tmp/lgs-phase29-active-light.png', fullPage: true });
  await dispatch({ type: 'providerNotice', provider: 'Local Ollama', state: 'offline', message: 'Connection refused.', ownership: 'none', canStart: true, canRestart: false }); assert.match(await page.locator('#provider-notice').innerText(), /Start/);
  await dispatch({ type: 'appearance', theme: 'lgs-dark' }); await dispatch({ type: 'providerNotice', provider: 'Local Ollama', state: 'starting', message: 'Waiting for readiness.', ownership: 'lgs-managed', canStart: false, canRestart: false }); await page.screenshot({ path: '/tmp/lgs-phase29-starting-dark.png', fullPage: true });
  await dispatch({ type: 'providerNotice', provider: 'Local Ollama', state: 'running', ownership: 'lgs-managed', canStart: false, canRestart: true }); assert.equal(await page.locator('#provider-notice').isHidden(), true);
  console.log('Chat browser flows passed at 240px, 360px, and 680px.');
} finally { await browser.close(); }
