import './styles.css';
import type { SafeConnection, SettingsHostMessage, SettingsState } from './messages.js';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void; getState(): unknown; setState(state: unknown): void };

const api = acquireVsCodeApi();
const app = document.querySelector<HTMLElement>('#app')!;
let state: SettingsState | undefined;
let active = 'appearance';
let scope: 'user' | 'workspace' = 'user';
let editingId: string | undefined;
let logConnectionId: string | undefined;
let logFilter = 'all';
let draftTestPassed = false;
let skillEditor: { sessionId: string; existingName?: string; existingScope?: 'project' | 'global'; proposal?: Extract<SettingsHostMessage, { type: 'skillGeneration' }> } | undefined;
let editingProfileId: string | undefined;

const categories = [
  ['appearance', 'Appearance'], ['providers', 'Providers'], ['skills', 'Skills'], ['plugins', 'Plugins'], ['agents', 'Agent Profiles'], ['permissions', 'Permissions'],
  ['usage', 'Usage'], ['integrations', 'Integrations'], ['verification', 'Verification'], ['diagnostics', 'Diagnostics'],
] as const;

window.addEventListener('message', event => receive(event.data as SettingsHostMessage));
api.postMessage({ type: 'refreshState' });

function receive(message: SettingsHostMessage): void {
  if (!message || typeof message !== 'object' || typeof message.type !== 'string') return;
  if (message.type === 'state') {
    state = { ...message, skills: message.skills || [], plugins: message.plugins || [], agentProfiles: message.agentProfiles || [] }; applyTheme(effectiveTheme()); render(); return;
  }
  if (message.type === 'notice') { notice(message.message, message.tone || 'info'); return; }
  if (message.type === 'connectionResult') {
    draftTestPassed = Boolean(message.draft && message.result.ok);
    const target = document.querySelector<HTMLElement>(message.draft ? '#draft-result' : `[data-result="${cssEscape(message.id)}"]`);
    if (target) target.innerHTML = diagnosticResult(message.result);
    document.querySelector<HTMLButtonElement>('#retry-diagnostic')?.addEventListener('click', () => {
      if (message.draft) document.querySelector<HTMLButtonElement>('#test-draft')?.click();
      else document.querySelector<HTMLButtonElement>(`[data-test="${cssEscape(message.id)}"]`)?.click();
    });
    document.querySelector<HTMLButtonElement>('[data-open-diagnostics]')?.addEventListener('click', () => { active = 'diagnostics'; editingId = undefined; logConnectionId = undefined; render(); });
    updateSaveAvailability(); return;
  }
  if (message.type === 'lifecycleResult') {
    notice(message.message, message.ok ? 'success' : 'error');
    document.querySelectorAll<HTMLButtonElement>('[data-lifecycle]').forEach(button => { button.disabled = false; });
  }
  if (message.type === 'skillGeneration') { if (skillEditor) skillEditor.proposal = message; renderExtensibility(); }
}

function render(): void {
  if (!state) return;
  app.innerHTML = `<div class="layout">
    <aside class="rail"><div class="identity"><div class="monogram">L</div><div><strong>LGS</strong><span>Settings</span></div></div>
      <nav>${categories.map(([id, label]) => `<button class="nav-item ${active === id ? 'active' : ''}" data-nav="${id}">${label}</button>`).join('')}</nav>
    </aside>
    <main class="content"><header class="page-header"><span></span>${restartMenu()}</header>
      <div id="notice" aria-live="polite">${state.errors.map(error => `<div class="notice error">${esc(error)}</div>`).join('')}</div>
      ${categories.map(([id, label]) => `<section id="${id}" class="section ${active === id ? 'active' : ''}" aria-label="${label}"></section>`).join('')}
    </main></div>`;
  bindNavigation(); renderAppearance(); renderProviders(); renderStructuredSections(); renderExtensibility(); bindLifecycle();
}

function restartMenu(): string {
  return `<details class="restart"><summary>Restart LGS <span aria-hidden="true">⌄</span></summary><div class="restart-menu">
    <button data-lifecycle="restartServices"><b>Restart LGS services</b><span>Cancel active LGS work and rebuild extension-owned services.</span></button>
    <button data-lifecycle="reconnectProviders"><b>Reconnect providers</b><span>Recreate adapters and test enabled connections.</span></button>
    <button data-lifecycle="restartLocalRuntimes"><b>Restart LGS-owned local runtimes</b><span>Only processes started and tracked by LGS are eligible.</span></button>
    <button data-lifecycle="reloadViews"><b>Reload LGS views</b><span>Refresh Settings and the sidebar without reloading VS Code.</span></button>
    <button data-lifecycle="reloadWindow" class="full-reload"><b>Reload VS Code Window</b><span>Full workbench reload; editors restore through VS Code.</span></button>
  </div></details>`;
}

function renderAppearance(): void {
  if (!state) return; const root = document.querySelector<HTMLElement>('#appearance')!; const item = setting('appearance.theme');
  const workspaceOverride = item.source === 'workspace';
  root.innerHTML = `<div class="section-title"><div><div class="eyebrow">Visual environment</div><h2>Appearance</h2><p>Theme cards apply immediately across open LGS views and persist at the selected scope.</p></div>
    <label class="scope"><span>Save theme to</span><select id="theme-scope"><option value="user" ${scope === 'user' ? 'selected' : ''}>User</option><option value="workspace" ${scope === 'workspace' ? 'selected' : ''} ${state.workspaceOpen ? '' : 'disabled'}>Workspace</option></select></label></div>
    ${workspaceOverride ? `<div class="scope-warning"><b>Workspace preference active.</b> It overrides your user theme here. Choose Workspace to change the visible workspace theme; saving to User updates your default elsewhere.</div>` : ''}
    <div class="theme-grid">
      ${themeCard('vscode', 'Follow VS Code', 'Native workbench color roles and active theme contrast.', `<i class="mini-rail"></i><i class="mini-editor"><em></em><em></em><em></em></i>`)}
      ${themeCard('lgs-light', 'Research Paper', 'Warm ivory, graphite, academic green, and restrained brass.', `<i class="paper-margin"></i><i class="paper-lines"></i><i class="paper-note">Aa</i>`)}
      ${themeCard('lgs-dark', 'Warm Dark', 'Deep navy, slate, sage, and restrained amber.', `<i class="lab-panel"><em></em><em></em></i><i class="lab-trace"></i>`)}
    </div><p class="source-line">Effective source: ${esc(item.source)} · ${workspaceOverride ? 'workspace choice takes precedence' : 'click a card to switch'}</p>`;
  root.querySelector<HTMLSelectElement>('#theme-scope')!.onchange = event => { scope = (event.currentTarget as HTMLSelectElement).value as typeof scope; renderAppearance(); };
  root.querySelectorAll<HTMLButtonElement>('[data-theme]').forEach(card => card.onclick = () => {
    const theme = card.dataset.theme as 'vscode' | 'lgs-light' | 'lgs-dark'; applyTheme(theme);
    root.querySelectorAll('[data-theme]').forEach(item => item.classList.toggle('selected', item === card));
    api.postMessage({ type: 'setAppearance', theme, scope });
  });
}

function themeCard(theme: string, name: string, description: string, preview: string): string {
  return `<button class="theme-card theme-${theme} ${effectiveTheme() === theme ? 'selected' : ''}" data-theme="${theme}" aria-pressed="${effectiveTheme() === theme}">
    <span class="theme-preview">${preview}</span><span class="theme-copy"><b>${name}</b><small>${description}</small></span><span class="selected-mark">✓ Active</span></button>`;
}

function renderProviders(): void {
  if (!state) return; const root = document.querySelector<HTMLElement>('#providers')!;
  const defaultConnection = setting('models.defaultConnection'); const defaultModel = setting('models.defaultModel');
  root.innerHTML = `<div class="section-title"><div><div class="eyebrow">Inference registry</div><h2>Models & Providers</h2><p>Each connection has its own identity, credentials, policy, health, models, activity, and usage record.</p></div><button class="primary" id="add-connection">Add model connection</button></div>
    <div class="provider-defaults"><label><span>Default connection</span><select id="default-connection"><option value="">First enabled connection</option>${state.connections.map(c => `<option value="${esc(c.id)}" ${c.id === defaultConnection.value ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select><small>Saved to ${esc(defaultConnection.source)}</small></label>
    <label><span>Default model</span><input id="default-model" value="${esc(defaultModel.value)}" placeholder="Use first discovered model"><small>Saved to ${esc(defaultModel.source)}</small></label><label><span>Save defaults to</span><select id="defaults-scope"><option value="user">User</option><option value="workspace" ${state.workspaceOpen ? '' : 'disabled'}>Workspace</option></select></label><button class="secondary" id="save-defaults">Save defaults</button></div>
    <div class="connection-list">${state.connections.length ? state.connections.map(connectionCard).join('') : emptyConnections()}</div>
    ${editingId !== undefined ? connectionEditor(state.connections.find(c => c.id === editingId)) : ''}
    ${logConnectionId ? logsView(state.connections.find(c => c.id === logConnectionId)) : ''}`;
  bindProviderActions(root);
}

function connectionCard(connection: SafeConnection): string {
  const status = statusLabel(connection.status.state); const statistics = connection.statistics;
  return `<article class="connection-card"><div class="connection-accent ${connection.status.state}"></div><div class="connection-main">
    <div class="connection-heading"><div><h3>${esc(connection.name)}</h3><div class="endpoint"><span>${apiTypeLabel(connection.kind)}</span><code>${esc(endpointSummary(connection.baseUrl))}</code></div></div><span class="status ${connection.status.state}"><i></i>${status}</span></div>
    <p class="connection-message">${esc(connection.status.message || 'Not tested.')}${connection.status.checkedAt ? ` · checked ${relative(connection.status.checkedAt)}` : ''}</p>
    <div class="connection-facts"><span><b>${connection.status.modelCount ?? connection.models.length}</b> models</span><span><b>${statistics.totalRequests}</b> recorded requests</span><span>${billingLabel(connection.pricing?.billing)}</span><span>${policyLabel(connection.dataPolicy)}</span>${connection.kind === 'ollama' ? `<span>${connection.ollamaRuntime?.ownership === 'lgs-managed' ? 'LGS managed' : 'External'}</span>${connection.ollamaRuntime?.pid ? `<span>PID ${connection.ollamaRuntime.pid}</span>` : ''}` : ''}</div>
    <div class="connection-actions"><button class="secondary" data-manage="${esc(connection.id)}">Manage</button><button class="secondary" data-test="${esc(connection.id)}">Test connection</button><button class="quiet" data-logs="${esc(connection.id)}">Logs</button><button class="quiet" data-toggle="${esc(connection.id)}">${connection.enabled ? 'Disable' : 'Enable'}</button>
      ${connection.kind === 'ollama' && connection.ollamaRuntime?.state !== 'running' && connection.ollamaManagement?.mode === 'lgs-managed' ? `<button class="quiet" data-ollama="start" data-id="${esc(connection.id)}">Start</button>` : ''}${connection.kind === 'ollama' && connection.ollamaRuntime?.ownership === 'lgs-managed' ? `<button class="quiet" data-ollama="restart" data-id="${esc(connection.id)}">Restart</button>` : ''}${connection.kind === 'ollama' && connection.ollamaRuntime?.ownership !== 'lgs-managed' ? `<button class="quiet" data-ollama="refresh" data-id="${esc(connection.id)}">Reconnect</button>` : ''}
      <details class="overflow"><summary aria-label="More actions">•••</summary><button class="destructive" data-delete="${esc(connection.id)}">Delete connection</button></details></div>
    <div class="inline-result" data-result="${esc(connection.id)}"></div></div></article>`;
}

function bindProviderActions(root: HTMLElement): void {
  root.querySelector<HTMLButtonElement>('#add-connection')!.onclick = () => { editingId = ''; draftTestPassed = false; logConnectionId = undefined; renderProviders(); };
  root.querySelector<HTMLButtonElement>('#save-defaults')!.onclick = () => {
    const connection = root.querySelector<HTMLSelectElement>('#default-connection')!.value; const model = root.querySelector<HTMLInputElement>('#default-model')!.value;
    const targetScope = root.querySelector<HTMLSelectElement>('#defaults-scope')!.value;
    api.postMessage({ type: 'setSetting', id: 'models.defaultConnection', value: connection, scope: targetScope });
    api.postMessage({ type: 'setSetting', id: 'models.defaultModel', value: model, scope: targetScope });
  };
  root.querySelectorAll<HTMLButtonElement>('[data-manage]').forEach(button => button.onclick = () => { editingId = button.dataset.manage; logConnectionId = undefined; draftTestPassed = true; renderProviders(); });
  root.querySelectorAll<HTMLButtonElement>('[data-test]').forEach(button => button.onclick = () => { setTesting(button.dataset.test!); api.postMessage({ type: 'testConnection', id: button.dataset.test }); });
  root.querySelectorAll<HTMLButtonElement>('[data-logs]').forEach(button => button.onclick = () => { logConnectionId = button.dataset.logs; editingId = undefined; logFilter = 'all'; renderProviders(); });
  root.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach(button => button.onclick = () => { const connection = state!.connections.find(c => c.id === button.dataset.toggle)!; api.postMessage({ type: 'setConnectionEnabled', id: connection.id, enabled: !connection.enabled }); });
  root.querySelectorAll<HTMLButtonElement>('[data-delete]').forEach(button => button.onclick = () => { const connection = state!.connections.find(c => c.id === button.dataset.delete); if (connection && confirm(`Delete ${connection.name} and its LGS-managed credentials? This cannot be undone.`)) api.postMessage({ type: 'deleteConnection', id: connection.id }); });
  root.querySelectorAll<HTMLButtonElement>('[data-ollama]').forEach(button => button.onclick = () => api.postMessage({ type: 'ollamaAction', id: button.dataset.id, action: button.dataset.ollama }));
  bindEditor(root); bindLogs(root);
}

function connectionEditor(connection?: SafeConnection): string {
  const c = connection || newConnection(); const isNew = !connection; const automatic = c.discoveryMode === 'automatic'; const manual = c.discoveryMode === 'manual';
  return `<div class="overlay" role="dialog" aria-modal="true" aria-label="${isNew ? 'Add model connection' : `Manage ${esc(c.name)}`}"><div class="dialog">
    <div class="dialog-head"><div><div class="eyebrow">${isNew ? 'New connection' : apiTypeLabel(c.kind)}</div><h2>${isNew ? 'Add model connection' : `Manage ${esc(c.name)}`}</h2><p>Internal identity is generated by LGS. Display names are arbitrary and never select the adapter.</p></div><button class="icon-button" id="close-editor" aria-label="Close">×</button></div>
    <form id="connection-form"><input type="hidden" name="id" value="${esc(c.id)}"><div class="form-grid">
      <label><span>Display Name</span><input name="name" value="${esc(c.name)}" placeholder="Purdue GenAI" required></label>
      <label><span>API Type</span><select name="kind">${(['ollama', 'openai', 'openai-compatible', 'anthropic'] as const).map(kind => `<option value="${kind}" ${kind === c.kind ? 'selected' : ''}>${apiTypeLabel(kind)}</option>`).join('')}</select></label>
      <label class="wide"><span>Base URL</span><input name="baseUrl" type="url" value="${esc(c.baseUrl)}" required></label>
      <label class="credential ${c.kind === 'ollama' ? 'hidden' : ''}"><span>API key</span><input name="apiKey" type="password" autocomplete="new-password" placeholder="${c.hasApiKey ? 'Stored — leave blank to keep' : 'Stored securely after save'}"><small>The value is sent only to the extension host and never returned.</small></label>
      <label><span>Model discovery</span><select name="discoveryMode"><option value="automatic" ${automatic ? 'selected' : ''}>Automatic</option><option value="manual" ${manual ? 'selected' : ''}>Manual list</option><option value="disabled" ${c.discoveryMode === 'disabled' ? 'selected' : ''}>Disabled</option></select></label>
      <label class="ollama-management ${c.kind === 'ollama' ? '' : 'hidden'}"><span>Server management</span><select name="ollamaMode"><option value="lgs-managed" ${c.ollamaManagement?.mode === 'lgs-managed' ? 'selected' : ''}>LGS managed</option><option value="external" ${c.ollamaManagement?.mode !== 'lgs-managed' ? 'selected' : ''}>External</option></select></label>
      <label class="ollama-management check ${c.kind === 'ollama' ? '' : 'hidden'}"><input type="checkbox" name="ollamaAutoStart" ${c.ollamaManagement?.autoStart ? 'checked' : ''}> Start local Ollama when unavailable</label>
      <label class="discovery-path ${automatic ? '' : 'hidden'}"><span>Discovery path override</span><input name="discoveryPath" value="${esc(c.discoveryPath || '')}" placeholder="Use adapter default"></label>
      <label class="manual-models wide ${manual ? '' : 'hidden'}"><span>Manual model IDs</span><textarea name="manualModels" placeholder="model-one&#10;model-two">${esc(c.manualModels.join('\n'))}</textarea></label>
    </div>
    ${connection && c.models.length ? modelTable(c) : ''}
    <details class="advanced"><summary>Advanced configuration</summary><div class="advanced-grid">
      <label><span>Normal headers (JSON)</span><textarea name="headers">${esc(JSON.stringify(c.headers, null, 2))}</textarea><small>Authorization and API keys must use secret fields.</small></label>
      <label><span>Secret headers</span><textarea name="secretHeaders" placeholder="Header-Name=value">${esc(c.secretHeaderNames.map(name => `${name}=`).join('\n'))}</textarea><small>Stored values are never filled back into this form.</small></label>
      <label><span>Model aliases (JSON)</span><textarea name="modelAliases">${esc(JSON.stringify(c.modelAliases, null, 2))}</textarea></label>
      <label><span>Context overrides (JSON)</span><textarea name="contextOverrides">${esc(JSON.stringify(c.contextOverrides, null, 2))}</textarea></label>
      <fieldset><legend>Capability overrides</legend>${['reasoning', 'multimodal', 'toolCalling', 'usage'].map(capability => { const value = c.capabilityOverrides[capability as keyof typeof c.capabilityOverrides]; return `<label><span>${capabilityLabel(capability)}</span><select name="capability-${capability}"><option value="auto" ${value === undefined ? 'selected' : ''}>Adapter default</option><option value="true" ${value === true ? 'selected' : ''}>Supported</option><option value="false" ${value === false ? 'selected' : ''}>Not supported</option></select></label>`; }).join('')}</fieldset>
      <label><span>Privacy / data policy</span><select name="dataPolicy">${['local', 'repository_allowed', 'metadata_only', 'cloud'].map(policy => `<option value="${policy}" ${policy === c.dataPolicy ? 'selected' : ''}>${policyLabel(policy as SafeConnection['dataPolicy'])}</option>`).join('')}</select></label>
      <label><span>Billing classification</span><select name="billing"><option value="unknown" ${c.pricing?.billing === 'unknown' ? 'selected' : ''}>Unknown</option><option value="commercial" ${c.pricing?.billing === 'commercial' ? 'selected' : ''}>Commercial</option><option value="institution_provided" ${c.pricing?.billing === 'institution_provided' ? 'selected' : ''}>Institution-provided</option><option value="local" ${c.pricing?.billing === 'local' ? 'selected' : ''}>Local / not applicable</option></select></label>
      <div class="pricing ${c.pricing?.billing === 'commercial' ? '' : 'hidden'}"><label><span>Input / 1M USD</span><input name="inputPrice" type="number" min="0" step="any" value="${numberInput(c.pricing?.inputPerMillionUsd)}"></label><label><span>Cached / 1M USD</span><input name="cachedPrice" type="number" min="0" step="any" value="${numberInput(c.pricing?.cachedInputPerMillionUsd)}"></label><label><span>Output / 1M USD</span><input name="outputPrice" type="number" min="0" step="any" value="${numberInput(c.pricing?.outputPerMillionUsd)}"></label></div>
    </div></details>
    <label class="check enabled"><input type="checkbox" name="enabled" ${c.enabled ? 'checked' : ''}> Enable this connection</label>
    <div id="draft-result" class="diagnostic"></div>
    ${isNew ? '<label class="offline-confirm check"><input type="checkbox" id="allow-offline"> Save without a successful test because this endpoint is temporarily offline</label>' : ''}
    <div class="dialog-actions"><button type="button" class="secondary" id="test-draft">Test connection</button><button type="submit" class="primary" id="save-connection" ${isNew ? 'disabled' : ''}>Save connection</button></div>
    </form></div></div>`;
}

function bindEditor(root: HTMLElement): void {
  const form = root.querySelector<HTMLFormElement>('#connection-form'); if (!form) return;
  root.querySelector<HTMLButtonElement>('#close-editor')!.onclick = () => { editingId = undefined; renderProviders(); };
  const adapt = () => {
    const kind = field<HTMLSelectElement>(form, 'kind').value; const mode = field<HTMLSelectElement>(form, 'discoveryMode').value;
    form.querySelector('.credential')!.classList.toggle('hidden', kind === 'ollama');
    form.querySelectorAll('.ollama-management').forEach(item => item.classList.toggle('hidden', kind !== 'ollama'));
    form.querySelector('.discovery-path')!.classList.toggle('hidden', mode !== 'automatic'); form.querySelector('.manual-models')!.classList.toggle('hidden', mode !== 'manual');
    if (!field<HTMLInputElement>(form, 'baseUrl').dataset.edited) field<HTMLInputElement>(form, 'baseUrl').value = defaultUrl(kind);
  };
  field<HTMLSelectElement>(form, 'kind').onchange = adapt; field<HTMLSelectElement>(form, 'discoveryMode').onchange = adapt;
  field<HTMLInputElement>(form, 'baseUrl').oninput = event => { (event.currentTarget as HTMLInputElement).dataset.edited = 'true'; };
  field<HTMLSelectElement>(form, 'billing').onchange = event => form.querySelector('.pricing')!.classList.toggle('hidden', (event.currentTarget as HTMLSelectElement).value !== 'commercial');
  root.querySelector<HTMLInputElement>('#allow-offline')?.addEventListener('change', updateSaveAvailability);
  root.querySelector<HTMLButtonElement>('#test-draft')!.onclick = () => { draftTestPassed = false; root.querySelector('#draft-result')!.innerHTML = '<div class="test-running"><span class="spinner"></span> Testing reachability, authentication, discovery, and protocol…</div>'; api.postMessage({ type: 'testDraftConnection', connection: serializeConnection(form) }); };
  form.onsubmit = event => { event.preventDefault(); try { api.postMessage({ type: 'saveConnection', connection: serializeConnection(form) }); editingId = undefined; } catch (error) { notice(error instanceof Error ? error.message : 'Review the connection fields.', 'error'); } };
}

function serializeConnection(form: HTMLFormElement): Record<string, unknown> {
  const json = (name: string): Record<string, unknown> => { const value = field<HTMLTextAreaElement>(form, name).value.trim(); if (!value) return {}; const parsed: unknown = JSON.parse(value); if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error(`${name} must be a JSON object.`); return parsed as Record<string, unknown>; };
  const secretHeaders: Record<string, string> = {}; const secretHeaderNames: string[] = [];
  for (const line of field<HTMLTextAreaElement>(form, 'secretHeaders').value.split('\n').map(value => value.trim()).filter(Boolean)) { const split = line.indexOf('='); const name = (split < 0 ? line : line.slice(0, split)).trim(); if (!name) continue; secretHeaderNames.push(name); if (split >= 0 && line.slice(split + 1)) secretHeaders[name] = line.slice(split + 1); }
  const number = (name: string) => { const value = field<HTMLInputElement>(form, name)?.value; return value ? Number(value) : undefined; };
  return {
    id: field<HTMLInputElement>(form, 'id').value || undefined, name: field<HTMLInputElement>(form, 'name').value.trim(), kind: field<HTMLSelectElement>(form, 'kind').value,
    baseUrl: field<HTMLInputElement>(form, 'baseUrl').value.trim(), apiKey: field<HTMLInputElement>(form, 'apiKey').value || undefined, enabled: field<HTMLInputElement>(form, 'enabled').checked,
    discoveryMode: field<HTMLSelectElement>(form, 'discoveryMode').value, discoveryPath: field<HTMLInputElement>(form, 'discoveryPath').value.trim() || undefined,
    manualModels: field<HTMLTextAreaElement>(form, 'manualModels').value.split('\n').map(value => value.trim()).filter(Boolean), headers: json('headers'), secretHeaders, secretHeaderNames,
    modelAliases: json('modelAliases'), contextOverrides: json('contextOverrides'), capabilityOverrides: Object.fromEntries(['reasoning', 'multimodal', 'toolCalling', 'usage'].flatMap(name => { const value = field<HTMLSelectElement>(form, `capability-${name}`).value; return value === 'auto' ? [] : [[name, value === 'true']]; })),
    dataPolicy: field<HTMLSelectElement>(form, 'dataPolicy').value, pricing: { billing: field<HTMLSelectElement>(form, 'billing').value, inputPerMillionUsd: number('inputPrice'), cachedInputPerMillionUsd: number('cachedPrice'), outputPerMillionUsd: number('outputPrice') },
    ollamaManagement: { mode: field<HTMLSelectElement>(form, 'ollamaMode').value, autoStart: field<HTMLInputElement>(form, 'ollamaAutoStart').checked },
    allowOffline: rootChecked('#allow-offline'),
  };
}

function modelTable(connection: SafeConnection): string {
  return `<div class="models"><div class="subhead"><div><h3>Discovered models</h3><p>IDs remain scoped to ${esc(connection.name)}.</p></div><button type="button" class="quiet" data-test="${esc(connection.id)}">Refresh discovery</button></div><div class="model-list">${connection.models.map(model => `<div><code>${esc(model.id)}</code><span>${esc(model.displayName || connection.modelAliases[model.id] || 'No alias')}</span><span>${model.contextWindow ? `${formatNumber(model.contextWindow)} context` : 'Context unavailable'}</span><span>${capabilities(model.capabilities || connection.capabilityOverrides)}</span></div>`).join('')}</div></div>`;
}

function logsView(connection?: SafeConnection): string {
  if (!connection) return '';
  const activities = connection.activities.filter(item => logFilter === 'all' || logFilter === 'errors' && item.result === 'failed' || logFilter === 'requests' && item.type === 'request' || logFilter === 'models' && item.type === 'models' || logFilter === 'connection' && item.type === 'connection' || logFilter === 'usage' && item.type === 'usage'); const runtimeLogs = connection.ollamaLogs || [];
  return `<div class="overlay" role="dialog" aria-modal="true" aria-label="Provider activity"><div class="dialog logs-dialog"><div class="dialog-head"><div><div class="eyebrow">Redacted local diagnostics</div><h2>${esc(connection.name)} activity</h2><p>Prompts and responses are not stored. Credentials and sensitive headers are redacted.</p></div><button class="icon-button" id="close-logs">×</button></div>
    ${statisticsView(connection)}<div class="filter-row">${['all', 'errors', 'requests', 'models', 'connection', 'usage'].map(filter => `<button class="filter ${filter === logFilter ? 'active' : ''}" data-filter="${filter}">${title(filter)}</button>`).join('')}</div>
    <div class="activity-list">${runtimeLogs.map(entry => `<article><time>${formatDate(entry.at)}</time><span class="event-type">${esc(entry.stream)}</span><div><b>Ollama runtime</b><p>${esc(entry.text)}</p></div><span class="result info">info</span></article>`).join('')}${activities.length ? activities.map(activity => `<article><time>${formatDate(activity.timestamp)}</time><span class="event-type">${esc(activity.type)}</span><div><b>${esc(activity.operation)}</b><p>${esc(activity.message)}</p>${activity.model ? `<code>${esc(activity.model)}</code>` : ''}${activity.durationMs !== undefined ? `<small>${formatNumber(activity.durationMs)} ms</small>` : ''}<details><summary>Raw diagnostics</summary><pre>${esc(activity.raw || 'No additional raw diagnostics were recorded.')}</pre></details></div><span class="result ${activity.result}">${activity.result}</span></article>`).join('') : runtimeLogs.length ? '' : '<div class="empty"><b>No activity</b></div>'}</div></div></div>`;
}

function bindLogs(root: HTMLElement): void {
  root.querySelector<HTMLButtonElement>('#close-logs')?.addEventListener('click', () => { logConnectionId = undefined; renderProviders(); });
  root.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(button => button.onclick = () => { logFilter = button.dataset.filter || 'all'; renderProviders(); });
}

function statisticsView(connection: SafeConnection): string {
  const s = connection.statistics; const outcomeKnown = s.successRate !== undefined;
  return `<div class="statistics"><div><span>Total requests</span><b>${s.totalRequests}</b><small>recorded</small></div><div><span>Success rate</span><b>${outcomeKnown ? `${Math.round(s.successRate! * 100)}%` : '—'}</b><small>${outcomeKnown ? 'reported outcomes' : 'unavailable'}</small></div><div><span>Total tokens</span><b>${formatNumber(s.totalTokens)}</b><small>${formatNumber(s.cachedTokens)} cached</small></div><div><span>Average latency</span><b>${s.averageLatencyMs === undefined ? '—' : `${formatNumber(s.averageLatencyMs)} ms`}</b><small>${s.peakLatencyMs === undefined ? 'unavailable' : `${formatNumber(s.peakLatencyMs)} ms peak`}</small></div><div><span>Average speed</span><b>${s.averageTokensPerSecond === undefined ? '—' : `${s.averageTokensPerSecond} t/s`}</b><small>${s.peakTokensPerSecond === undefined ? 'unavailable' : `${s.peakTokensPerSecond} t/s peak`}</small></div><div><span>Cost</span><b>${cost(s.providerReportedCostUsd)}</b><small>${s.providerReportedCostUsd !== undefined ? 'provider reported' : s.estimatedCostUsd !== undefined ? `${cost(s.estimatedCostUsd)} estimated` : billingLabel(connection.pricing?.billing)}</small></div><div><span>Tasks served</span><b>${s.tasksServed}</b><small>${s.agentInvocations} agent invocations</small></div><div><span>Most-used model</span><b class="small-value">${esc(s.mostUsedModel || '—')}</b><small>${s.mostUsedModel ? 'reported' : 'unavailable'}</small></div></div>`;
}

function renderStructuredSections(): void {
  if (!state) return;
  document.querySelector('#agents')!.innerHTML = purposeSection('Role assignments', 'Assign complete connection and model identities to Manager, Worker, Reviewer, Researcher, Documentation, Vision, and escalation roles.', 'Open agent configuration', 'Role mappings inherit from Manager only when not explicitly set.');
  const computer = state.settings.filter(item => item.category === 'Computer Access');
  document.querySelector('#permissions')!.innerHTML = `<div class="section-title"><div><div class="eyebrow">Security boundary</div><h2>Permissions</h2><p>External computer operations use explicit policy controls. Workspace commands remain separately governed.</p></div></div><div class="permission-matrix">${computer.map(permissionRow).join('')}</div><button class="secondary open-config">Review complete permission policy</button>`;
  document.querySelector('#usage')!.innerHTML = purposeSection('Usage & billing', 'Inspect provider-reported and estimated usage without storing prompts, responses, source, or tool payloads.', 'Open Usage Dashboard', 'Institution-provided billing is distinct from commercial zero cost.', 'usage');
  document.querySelector('#integrations')!.innerHTML = purposeSection('Integration catalog', 'Review configured MCP and plugin integrations, their permission requests, ownership, and connection state.', 'Open integration configuration', 'Uninstalled integrations are never presented as connected.');
  document.querySelector('#verification')!.innerHTML = purposeSection('Definition of Done', 'Configure evidence gates, verification command arrays, documentation checks, runtime checks, and independent review.', 'Open verification configuration', 'Commands are executable-plus-argument arrays and never assume npm.');
  document.querySelector('#diagnostics')!.innerHTML = `<div class="section-title"><div><div class="eyebrow">Recovery & evidence</div><h2>Diagnostics</h2><p>Use lightweight recovery first. A full VS Code reload is clearly separated below.</p></div></div><div class="diagnostic-actions">${restartMenu().replace('<details class="restart">', '<details class="restart" open>')}</div><div class="diagnostic-note"><b>Process ownership boundary</b><p>LGS restart actions never terminate externally owned Ollama, LM Studio, llama.cpp, or other provider processes. Only tracked LGS-owned child processes are eligible.</p></div>`;
  document.querySelectorAll<HTMLButtonElement>('.open-config').forEach(button => button.onclick = () => api.postMessage({ type: 'openWorkspaceConfig' }));
  document.querySelectorAll<HTMLButtonElement>('[data-open-usage]').forEach(button => button.onclick = () => api.postMessage({ type: 'openUsage' }));
  document.querySelectorAll<HTMLSelectElement>('[data-setting]').forEach(select => select.onchange = () => api.postMessage({ type: 'setSetting', id: select.dataset.setting, value: settingValue(select.dataset.setting!, select.value), scope }));
  document.querySelectorAll<HTMLInputElement>('[data-number-setting]').forEach(input => input.onchange = () => api.postMessage({ type: 'setSetting', id: input.dataset.numberSetting, value: Number(input.value), scope }));
  bindLifecycle();
}

function renderExtensibility(): void {
  if (!state) return;
  const workspace = state.agentWorkspace;
  document.querySelector('#skills')!.innerHTML = `<div class="section-title"><div><h2>Skills</h2><p>${state.skills.length} installed · metadata routed before instructions load</p></div><div class="row-actions">${workspace?.initialized ? '' : '<button class="secondary" id="initialize-agents">Initialize agent workspace</button>'}<button class="secondary" id="import-skill">Import</button><button class="primary" id="create-skill">Create skill</button></div></div>
    <div class="connection-list">${state.skills.length ? state.skills.map(skill => `<article class="connection-card"><div class="connection-main"><div class="connection-heading"><div><h3>${esc(skill.name)}</h3><div class="endpoint"><span>${esc(skill.scope)}</span><code>${esc(skill.source)}</code></div></div><span class="status ${skill.enabled ? 'online' : 'disabled'}"><i></i>${skill.enabled ? 'Enabled' : 'Disabled'}</span></div><p class="connection-message">${esc(skill.description)}</p><div class="connection-facts"><span>${formatNumber(skill.estimatedTokenCost)} estimated tokens</span><span>${skill.supportingFiles.length} resources</span><span>${skill.routing?.activation === 'manual' ? 'Manual' : 'Automatic matching'}</span>${skill.valid ? '' : `<span class="invalid">${esc(skill.validationErrors.join(' · '))}</span>`}</div><div class="connection-actions"><button class="secondary" data-open-skill="${esc(skill.path)}">Open files</button><button class="quiet" data-refine-skill="${esc(skill.name)}" data-skill-scope="${skill.scope}">Refine</button><button class="quiet" data-skill-name="${esc(skill.name)}" data-skill-scope="${skill.scope}" data-skill-enabled="${!skill.enabled}">${skill.enabled ? 'Disable' : 'Enable'}</button></div></div></article>`).join('') : '<div class="empty"><b>No installed skills</b></div>'}</div>${skillEditor ? skillGenerationDialog(skillEditor) : ''}`;
  document.querySelector('#plugins')!.innerHTML = `<div class="section-title"><div><h2>Plugins</h2><p>Executable capabilities and integrations</p></div></div><div class="connection-list">${state.plugins.length ? state.plugins.map(plugin => `<article class="connection-card"><div class="connection-main"><div class="connection-heading"><div><h3>${esc(plugin.name)}</h3><div class="endpoint"><code>${esc(plugin.source)}</code></div></div><span class="status ${plugin.enabled ? 'online' : 'disabled'}"><i></i>${plugin.enabled ? 'Enabled' : 'Disabled'}</span></div><p class="connection-message">${esc(plugin.description)}</p><div class="connection-facts"><span>${plugin.permissions.length} permissions</span></div></div></article>`).join('') : '<div class="empty"><b>No project plugins</b><p>Plugin sources remain separate from model providers and instruction skills.</p></div>'}</div>`;
  document.querySelector('#agents')!.innerHTML = `<div class="section-title"><div><h2>Agent Profiles</h2><p>Behavior defaults and guardrails; capabilities remain available unless explicitly restricted</p></div><button class="primary" id="new-profile">New profile</button></div><div class="profile-list">${state.agentProfiles.map(profile => `<article><div><b>${esc(profile.name)}</b><span>${profile.origin === 'built-in' ? `Default profile${profile.modified ? ' · Modified' : ''}` : 'User-created profile'} · ${esc(profile.description)}</span></div><code>${esc(profile.toolPreferences.join(' · '))}</code><div class="row-actions"><button class="quiet" data-edit-profile="${esc(profile.id)}">Edit</button>${profile.origin === 'built-in' && profile.modified ? `<button class="quiet" data-restore-profile="${esc(profile.id)}">Restore defaults</button>` : ''}</div></article>`).join('')}</div>${editingProfileId ? profileDialog(editingProfileId) : ''}`;
  document.querySelector<HTMLButtonElement>('#initialize-agents')?.addEventListener('click', () => api.postMessage({ type: 'initializeAgentWorkspace' }));
  document.querySelector<HTMLButtonElement>('#create-skill')!.onclick = () => { skillEditor = { sessionId: browserId('skill') }; renderExtensibility(); };
  document.querySelector<HTMLButtonElement>('#import-skill')!.onclick = () => api.postMessage({ type: 'importSkill', scope: 'project' });
  document.querySelectorAll<HTMLButtonElement>('[data-refine-skill]').forEach(button => button.onclick = () => { skillEditor = { sessionId: browserId('skill'), existingName: button.dataset.refineSkill, existingScope: button.dataset.skillScope as 'project' | 'global' }; renderExtensibility(); });
  bindSkillGeneration(); bindProfileEditor();
  document.querySelectorAll<HTMLButtonElement>('[data-open-skill]').forEach(button => button.onclick = () => api.postMessage({ type: 'openSkill', path: button.dataset.openSkill }));
  document.querySelectorAll<HTMLButtonElement>('[data-skill-name]').forEach(button => button.onclick = () => api.postMessage({ type: 'setSkillEnabled', name: button.dataset.skillName, scope: button.dataset.skillScope, enabled: button.dataset.skillEnabled === 'true' }));
}

function skillGenerationDialog(editor: NonNullable<typeof skillEditor>): string {
  const existing = state?.skills.find(item => item.name === editor.existingName && item.scope === editor.existingScope); const proposal = editor.proposal; const answers = proposal?.draft.answers || {};
  return `<div class="overlay" role="dialog" aria-modal="true"><div class="dialog"><div class="dialog-head"><div><div class="eyebrow">Skill Generation</div><h2>${existing ? `Refine ${esc(existing.name)}` : 'Create skill'}</h2><p>Review inferred patterns before any files change.</p></div><button class="icon-button" id="close-skill">×</button></div><form id="skill-form"><div class="form-grid">
    <label><span>Name</span><input name="skillName" value="${esc(proposal?.draft.skillName || existing?.name || '')}" ${existing ? 'readonly' : ''} required></label><label><span>Scope</span><select name="skillScope" ${existing ? 'disabled' : ''}><option value="project" ${(answers.scope || existing?.scope) !== 'global' ? 'selected' : ''}>Project</option><option value="global" ${(answers.scope || existing?.scope) === 'global' ? 'selected' : ''}>Global</option></select></label>
    <label class="wide"><span>Work to improve</span><input name="work" value="${esc(answers.work || existing?.description || '')}" required></label><label class="wide"><span>${existing ? 'Requested refinement' : 'Desired behavior or examples'}</span><textarea name="desiredExamples" required>${esc(answers.desiredExamples || '')}</textarea></label>
    <label><span>Avoid</span><textarea name="avoid" required>${esc(answers.avoid || '')}</textarea></label><label><span>Priorities / tradeoffs</span><textarea name="priorities" required>${esc(answers.priorities || '')}</textarea></label><label class="wide"><span>Environment / tooling constraints</span><textarea name="constraints" required>${esc(answers.constraints || '')}</textarea></label>
    <fieldset class="wide"><legend>Use with profiles</legend>${(state?.agentProfiles || []).map(profile => `<label class="check"><input type="checkbox" name="skillProfile" value="${esc(profile.id)}" ${(answers.profiles || existing?.routing?.profiles || []).includes(profile.id) ? 'checked' : ''}> ${esc(profile.name)}</label>`).join('')}</fieldset>
    <label><span>Activation</span><select name="activation"><option value="automatic" ${(answers.activation || existing?.routing?.activation) !== 'manual' ? 'selected' : ''}>Automatically when task matches</option><option value="manual" ${(answers.activation || existing?.routing?.activation) === 'manual' ? 'selected' : ''}>Manual activation only</option></select></label></div>
    ${proposal?.draft.patterns.length ? `<div class="proposal"><b>Inferred pattern</b><ul>${proposal.draft.patterns.map(item => `<li>${esc(item)}</li>`).join('')}</ul><details><summary>Proposed diff</summary><pre>${esc(proposal.diff || '')}</pre></details></div>` : ''}
    <div class="dialog-actions"><button type="button" class="secondary" id="review-skill">${proposal?.draft.proposal ? 'Update proposal' : 'Review proposal'}</button>${proposal?.draft.proposal ? '<button type="button" class="primary" id="approve-skill">Approve and save</button>' : ''}</div></form></div></div>`;
}

function bindSkillGeneration(): void { const form = document.querySelector<HTMLFormElement>('#skill-form'); if (!form || !skillEditor) return; document.querySelector<HTMLButtonElement>('#close-skill')!.onclick = () => { skillEditor = undefined; renderExtensibility(); }; document.querySelector<HTMLButtonElement>('#review-skill')!.onclick = () => { const profiles = Array.from(form.querySelectorAll<HTMLInputElement>('[name="skillProfile"]:checked')).map(item => item.value); api.postMessage({ type: 'prepareSkill', sessionId: skillEditor!.sessionId, existingName: skillEditor!.existingName, existingScope: skillEditor!.existingScope, name: field<HTMLInputElement>(form, 'skillName').value, work: field<HTMLInputElement>(form, 'work').value, desiredExamples: field<HTMLTextAreaElement>(form, 'desiredExamples').value, avoid: field<HTMLTextAreaElement>(form, 'avoid').value, priorities: field<HTMLTextAreaElement>(form, 'priorities').value, constraints: field<HTMLTextAreaElement>(form, 'constraints').value, scope: (field<HTMLSelectElement>(form, 'skillScope').value || skillEditor!.existingScope) as 'project' | 'global', profiles, activation: field<HTMLSelectElement>(form, 'activation').value }); }; document.querySelector<HTMLButtonElement>('#approve-skill')?.addEventListener('click', () => { api.postMessage({ type: 'approveSkill', sessionId: skillEditor!.sessionId }); skillEditor = undefined; renderExtensibility(); }); }

function profileDialog(id: string): string { const profile = state!.agentProfiles.find(item => item.id === id) || { id: '', name: '', description: '', origin: 'user' as const, modified: false, instructions: '', preferredSkills: [], autoLoadedSkills: [], toolPreferences: ['inspect'], researchBehavior: 'available' as const, executionBehavior: 'balanced' as const, verificationExpectations: [], policy: { preferences: [], defaults: { skills: [], research: 'available' as const, tools: [] }, requirements: [], restrictions: {} } }; return `<div class="overlay" role="dialog" aria-modal="true"><div class="dialog"><div class="dialog-head"><div><div class="eyebrow">${profile.origin === 'built-in' ? 'Default profile' : 'User profile'}</div><h2>${profile.id ? `Edit ${esc(profile.name)}` : 'New profile'}</h2></div><button class="icon-button" id="close-profile">×</button></div><form id="profile-form"><div class="form-grid"><label><span>ID</span><input name="profileId" value="${esc(profile.id)}" ${profile.origin === 'built-in' ? 'readonly' : ''} required pattern="[a-z][a-z0-9-]*"></label><label><span>Name</span><input name="profileName" value="${esc(profile.name)}" required></label><label class="wide"><span>Description</span><input name="profileDescription" value="${esc(profile.description)}" required></label><label class="wide"><span>Instructions</span><textarea name="profileInstructions" required>${esc(profile.instructions)}</textarea></label><label><span>Preferred skills</span><textarea name="preferredSkills">${esc(profile.preferredSkills.join('\n'))}</textarea></label><label><span>Automatically loaded skills</span><textarea name="autoSkills">${esc(profile.autoLoadedSkills.join('\n'))}</textarea></label><label><span>Model / provider</span><input name="profileModel" value="${esc(profile.model || '')}" placeholder="Optional model ID"></label><label><span>Reasoning default</span><select name="profileReasoning"><option value="">Provider default</option>${['low','medium','high'].map(value => `<option value="${value}" ${profile.reasoning === value ? 'selected' : ''}>${title(value)}</option>`).join('')}</select></label><label><span>Research behavior</span><select name="researchBehavior">${['available','prefer-current-sources','required-for-changing-facts'].map(value => `<option value="${value}" ${profile.researchBehavior === value ? 'selected' : ''}>${value.replaceAll('-', ' ')}</option>`).join('')}</select></label><label><span>Execution behavior</span><select name="executionBehavior">${['conservative','balanced','autonomous'].map(value => `<option value="${value}" ${profile.executionBehavior === value ? 'selected' : ''}>${title(value)}</option>`).join('')}</select><label class="wide"><span>Tool preferences</span><input name="toolPreferences" value="${esc(profile.toolPreferences.join(', '))}"></label><label class="wide"><span>Verification expectations</span><textarea name="verificationExpectations">${esc(profile.verificationExpectations.join('\n'))}</textarea></label><details class="wide advanced"><summary>Hard restrictions (rare)</summary><p>Plan Mode read-only enforcement is a product guarantee and cannot be weakened here.</p>${['code','commands','web'].map(value => `<label><span>${title(value)}</span><select name="restriction-${value}"><option value="allow">Allow</option><option value="deny" ${profile.policy.restrictions[value as keyof typeof profile.policy.restrictions] === 'deny' ? 'selected' : ''}>Deny</option></select></label>`).join('')}</details></div><div class="dialog-actions"><button class="primary" type="submit">Save profile</button></div></form></div></div>`; }

function bindProfileEditor(): void { document.querySelector<HTMLButtonElement>('#new-profile')!.onclick = () => { editingProfileId = '__new__'; renderExtensibility(); }; document.querySelectorAll<HTMLButtonElement>('[data-edit-profile]').forEach(button => button.onclick = () => { editingProfileId = button.dataset.editProfile; renderExtensibility(); }); document.querySelectorAll<HTMLButtonElement>('[data-restore-profile]').forEach(button => button.onclick = () => api.postMessage({ type: 'restoreAgentProfile', id: button.dataset.restoreProfile })); const form = document.querySelector<HTMLFormElement>('#profile-form'); if (!form) return; document.querySelector<HTMLButtonElement>('#close-profile')!.onclick = () => { editingProfileId = undefined; renderExtensibility(); }; form.onsubmit = event => { event.preventDefault(); const lines = (name: string) => field<HTMLTextAreaElement>(form, name).value.split(/\r?\n|,/).map(item => item.trim()).filter(Boolean); const id = field<HTMLInputElement>(form, 'profileId').value; const existing = state!.agentProfiles.find(item => item.id === id); api.postMessage({ type: 'saveAgentProfile', builtIn: existing?.origin === 'built-in', replaceUser: existing?.origin === 'user', profile: { id, name: field<HTMLInputElement>(form, 'profileName').value, description: field<HTMLInputElement>(form, 'profileDescription').value, instructions: field<HTMLTextAreaElement>(form, 'profileInstructions').value, preferredSkills: lines('preferredSkills'), autoLoadedSkills: lines('autoSkills'), model: field<HTMLInputElement>(form, 'profileModel').value || undefined, reasoning: field<HTMLSelectElement>(form, 'profileReasoning').value || undefined, toolPreferences: field<HTMLInputElement>(form, 'toolPreferences').value.split(',').map(item => item.trim()).filter(Boolean), researchBehavior: field<HTMLSelectElement>(form, 'researchBehavior').value, executionBehavior: field<HTMLSelectElement>(form, 'executionBehavior').value, verificationExpectations: lines('verificationExpectations'), policy: { restrictions: { code: field<HTMLSelectElement>(form, 'restriction-code').value, commands: field<HTMLSelectElement>(form, 'restriction-commands').value, web: field<HTMLSelectElement>(form, 'restriction-web').value } } } }); editingProfileId = undefined; renderExtensibility(); }; }

function purposeSection(titleText: string, description: string, action: string, note: string, mode?: 'usage'): string {
  return `<div class="section-title"><div><div class="eyebrow">Structured workspace policy</div><h2>${titleText}</h2><p>${description}</p></div></div><div class="purpose-panel"><div class="purpose-graphic ${mode || ''}"><i></i><i></i><i></i><i></i></div><div><h3>${titleText}</h3><p>${note}</p><button class="secondary ${mode === 'usage' ? '' : 'open-config'}" ${mode === 'usage' ? 'data-open-usage' : ''}>${action}</button></div></div>`;
}

function permissionRow(item: SettingsState['settings'][number]): string {
  const control = item.type === 'boolean' ? `<select data-setting="${esc(item.id)}"><option value="true" ${item.value ? 'selected' : ''}>Enabled</option><option value="false" ${!item.value ? 'selected' : ''}>Disabled</option></select>` : item.type === 'number' ? `<input type="number" value="${esc(item.value)}" data-number-setting="${esc(item.id)}">` : `<select data-setting="${esc(item.id)}">${(item.choices || []).map(choice => `<option value="${esc(choice.value)}" ${choice.value === item.value ? 'selected' : ''}>${esc(choice.label)}</option>`).join('')}</select>`;
  return `<div><div><b>${esc(item.label)}</b><span>${esc(item.description)}</span></div>${control}<small>${esc(item.source)}</small></div>`;
}

function bindNavigation(): void { document.querySelectorAll<HTMLButtonElement>('[data-nav]').forEach(button => button.onclick = () => { active = button.dataset.nav || 'appearance'; editingId = undefined; logConnectionId = undefined; render(); }); }
function bindLifecycle(): void { document.querySelectorAll<HTMLButtonElement>('[data-lifecycle]').forEach(button => button.onclick = () => { button.disabled = true; notice(`${button.querySelector('b')?.textContent || 'Recovery action'} in progress…`, 'info'); api.postMessage({ type: 'lifecycle', action: button.dataset.lifecycle }); }); }
function setTesting(id: string): void { const target = document.querySelector<HTMLElement>(`[data-result="${cssEscape(id)}"]`); if (target) target.innerHTML = '<div class="test-running"><span class="spinner"></span> Testing connection…</div>'; }
function updateSaveAvailability(): void { const save = document.querySelector<HTMLButtonElement>('#save-connection'); if (!save || editingId) return; save.disabled = !(draftTestPassed || rootChecked('#allow-offline')); }
function diagnosticResult(result: Extract<SettingsHostMessage, { type: 'connectionResult' }>['result']): string { return `<div class="diagnostic-result ${result.ok ? 'ok' : 'bad'}"><b>${esc(result.title)}</b><code>${esc(result.endpoint)}</code><p>${esc(result.summary)}</p>${result.guidance ? `<p>${esc(result.guidance)}</p>` : ''}<ul>${result.checks.map(check => `<li class="${check.result}"><span>${esc(check.name)}</span>${esc(check.detail)}</li>`).join('')}</ul>${result.ok ? '' : '<div class="result-actions"><button class="quiet" type="button" id="retry-diagnostic">Retry</button><button class="quiet" type="button" data-open-diagnostics>Open diagnostics</button></div>'}</div>`; }
function notice(message: string, tone = 'info'): void { const root = document.querySelector('#notice'); if (root) root.innerHTML = `<div class="notice ${tone}">${esc(message)}</div>`; }
function applyTheme(theme: string): void { document.documentElement.dataset.lgsTheme = theme; }
function effectiveTheme(): string { return String(setting('appearance.theme')?.value || 'vscode'); }
function setting(id: string): SettingsState['settings'][number] { return state?.settings.find(item => item.id === id) || { id, category: '', label: '', description: '', type: 'string', value: '', source: 'built-in', scope: 'both' }; }
function newConnection(): SafeConnection { return { id: '', name: '', kind: 'openai-compatible', baseUrl: 'http://localhost:1234/v1', enabled: true, headers: {}, secretHeaderNames: [], discoveryMode: 'automatic', manualModels: [], modelAliases: {}, capabilityOverrides: {}, contextOverrides: {}, pricing: { billing: 'unknown' }, dataPolicy: 'repository_allowed', ollamaManagement: { mode: 'external', autoStart: false }, hasApiKey: false, status: { state: 'unknown' }, models: [], statistics: { totalRequests: 0, successfulRequests: 0, failedRequests: 0, cancelledRequests: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, totalTokens: 0, activeGenerationMs: 0, tasksServed: 0, agentInvocations: 0 }, activities: [] }; }
function emptyConnections(): string { return '<div class="empty"><b>No model connections</b><p>Add an Ollama, OpenAI, OpenAI-compatible, or Anthropic connection. Connection IDs are generated independently from display names.</p></div>'; }
function defaultUrl(kind: string): string { return kind === 'ollama' ? 'http://localhost:11434' : kind === 'openai' ? 'https://api.openai.com/v1' : kind === 'anthropic' ? 'https://api.anthropic.com/v1' : 'http://localhost:1234/v1'; }
function apiTypeLabel(kind: string): string { return kind === 'openai-compatible' ? 'OpenAI Compatible' : kind === 'openai' ? 'OpenAI' : kind === 'ollama' ? 'Ollama' : 'Anthropic'; }
function statusLabel(status: string): string { return ({ online: 'Online', offline: 'Offline', testing: 'Testing', connecting: 'Connecting', authentication_failed: 'Authentication Failed', rate_limited: 'Rate Limited', degraded: 'Degraded', disabled: 'Disabled', unknown: 'Not tested' } as Record<string, string>)[status] || 'Unknown'; }
function billingLabel(value?: string): string { return value === 'institution_provided' ? 'Institution-provided' : value === 'commercial' ? 'Commercial billing' : value === 'local' ? 'Local · API cost n/a' : 'Billing unavailable'; }
function policyLabel(value?: SafeConnection['dataPolicy']): string { return value === 'local' ? 'Local only' : value === 'metadata_only' ? 'Metadata only' : value === 'cloud' || value === 'repository_allowed' ? 'Repository data allowed' : 'Policy unavailable'; }
function capabilityLabel(value: string): string { return value === 'multimodal' ? 'Vision / multimodal' : value === 'toolCalling' ? 'Tool calling' : title(value); }
function capabilities(value: Record<string, boolean | undefined>): string { const names = Object.entries(value).filter(([, supported]) => supported).map(([name]) => capabilityLabel(name)); return names.length ? names.join(', ') : 'Capabilities unavailable'; }
function endpointSummary(value: string): string { try { const url = new URL(value); return url.host + (url.pathname === '/' ? '' : url.pathname); } catch { return value; } }
function settingValue(id: string, value: string): unknown { return setting(id).type === 'boolean' ? value === 'true' : setting(id).type === 'number' ? Number(value) : value; }
function field<T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(form: HTMLFormElement, name: string): T { return form.elements.namedItem(name) as T; }
function rootChecked(selector: string): boolean { return document.querySelector<HTMLInputElement>(selector)?.checked || false; }
function numberInput(value?: number): string { return value === undefined ? '' : String(value); }
function cost(value?: number): string { return value === undefined ? '—' : `$${value.toFixed(value < 0.01 ? 4 : 2)}`; }
function formatNumber(value: number): string { return new Intl.NumberFormat().format(Math.round(value * 100) / 100); }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : date.toLocaleString(); }
function relative(value: string): string { const difference = Date.now() - Date.parse(value); if (!Number.isFinite(difference)) return value; const minutes = Math.round(difference / 60_000); return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.round(minutes / 60)}h ago` : `${Math.round(minutes / 1440)}d ago`; }
function title(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1); }
function browserId(prefix: string): string { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
function cssEscape(value: string): string { return value.replace(/["\\]/g, '\\$&'); }
function esc(value: unknown): string { return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!); }
