import './styles.css';
import { isHostMessage, type ChatOptions, type ClientMessage, type TaskDashboard } from '../shared/messages.js';

declare const acquireVsCodeApi: () => { postMessage(message: ClientMessage): void };
const vscode = acquireVsCodeApi();
const app = document.querySelector<HTMLDivElement>('#app')!;
let generating = false;
let currentAssistant: HTMLElement | undefined;
let dashboard: TaskDashboard | undefined;
let activeTaskTab = 'overview';
let activePane: 'chat' | 'task' = 'chat';

app.innerHTML = `
  <div class="lab-shell">
    <header class="topbar">
      <div class="identity"><span class="seal" aria-hidden="true">L</span><span><b>Little Grad Student</b><small>Research Lab</small></span></div>
      <div class="header-actions">
        <button class="icon-button" id="new" aria-label="New research task" title="New task">+</button>
        <button class="icon-button" id="settings" aria-label="Open LGS settings" title="Settings">⚙</button>
      </div>
    </header>
    <div class="statusbar"><span class="status-dot" id="status-dot"></span><span id="state">Connecting…</span><button id="usage-link">Usage</button></div>
    <details class="sessions"><summary><span>Lab notebook</span><span id="session-count">0 sessions</span></summary><div id="chats"></div></details>
    <nav class="view-tabs" aria-label="Workspace view"><button data-pane="chat" aria-selected="true">Conversation</button><button data-pane="task" aria-selected="false" disabled>Task evidence</button></nav>
    <div id="error-region" aria-live="assertive"></div>
    <section id="task-dashboard" aria-live="polite" hidden></section>
    <main aria-live="polite" id="history">
      <div class="empty">
        <div class="folio" aria-hidden="true"><span>LGS</span></div>
        <h1>Begin an investigation</h1>
        <p>Describe the engineering outcome and what evidence should prove it complete.</p>
        <div class="empty-cues"><span>Repository-aware</span><span>Evidence-gated</span><span>Provider-neutral</span></div>
      </div>
    </main>
    <section id="completion" aria-live="polite" hidden>
      <button id="completion-toggle" type="button" aria-expanded="false"><span><i></i>Committee review</span><span id="completion-progress"></span></button>
      <div id="completion-checklist" hidden></div>
    </section>
    <section class="composer" aria-label="Task composer">
      <div class="composer-context"><span id="mode-label">Implementation</span><button id="options-toggle" type="button" aria-expanded="false">Run settings</button></div>
      <div class="options-panel" id="options-panel" hidden>
        <label><span>Connection</span><select id="profile" aria-label="Advisor provider profile"></select></label>
        <label><span>Model</span><select id="model" aria-label="Advisor model"><option>Discovering models…</option></select></label>
        <label><span>Mode</span><select id="mode" aria-label="Task mode"><option value="implementation">Implementation</option><option value="planning">Planning · read only</option></select></label>
        <label><span>Reasoning</span><select id="thinking" aria-label="Reasoning effort"><option value="off">Standard</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
        <label><span>Commands</span><select id="approval" aria-label="Command approval"><option value="always">Use allowed commands</option><option value="on-request">Ask when required</option><option value="never">Deny commands</option></select></label>
      </div>
      <form id="composer-form">
        <textarea id="input" rows="2" maxlength="4000" placeholder="Describe the task, constraints, and acceptance criteria…" aria-label="Task objective"></textarea>
        <div class="composer-bottom"><span id="composer-hint">Ctrl/⌘ Enter</span><div><button id="stop" class="stop-button" type="button" aria-label="Stop generation" hidden>Stop</button><button id="send" class="send-button" type="submit" aria-label="Send task"><span>Send</span><b>↑</b></button></div></div>
      </form>
    </section>
  </div>`;

const history = app.querySelector<HTMLElement>('#history')!;
const input = app.querySelector<HTMLTextAreaElement>('#input')!;
const send = app.querySelector<HTMLButtonElement>('#send')!;
const stop = app.querySelector<HTMLButtonElement>('#stop')!;
const state = app.querySelector<HTMLElement>('#state')!;
const statusDot = app.querySelector<HTMLElement>('#status-dot')!;
const profile = app.querySelector<HTMLSelectElement>('#profile')!;
const model = app.querySelector<HTMLSelectElement>('#model')!;
const mode = app.querySelector<HTMLSelectElement>('#mode')!;
const thinking = app.querySelector<HTMLSelectElement>('#thinking')!;
const approval = app.querySelector<HTMLSelectElement>('#approval')!;
const chats = app.querySelector<HTMLElement>('#chats')!;
const completion = app.querySelector<HTMLElement>('#completion')!;
const completionProgress = app.querySelector<HTMLElement>('#completion-progress')!;
const completionChecklist = app.querySelector<HTMLElement>('#completion-checklist')!;
const completionToggle = app.querySelector<HTMLButtonElement>('#completion-toggle')!;
const taskPanel = app.querySelector<HTMLElement>('#task-dashboard')!;
const errorRegion = app.querySelector<HTMLElement>('#error-region')!;
const optionsPanel = app.querySelector<HTMLElement>('#options-panel')!;
const optionsToggle = app.querySelector<HTMLButtonElement>('#options-toggle')!;

completionToggle.onclick = () => {
  const expanded = completionToggle.getAttribute('aria-expanded') === 'true';
  completionToggle.setAttribute('aria-expanded', String(!expanded)); completionChecklist.hidden = expanded;
};
optionsToggle.onclick = () => {
  const expanded = optionsToggle.getAttribute('aria-expanded') === 'true';
  optionsToggle.setAttribute('aria-expanded', String(!expanded)); optionsPanel.hidden = expanded;
};
profile.onchange = () => vscode.postMessage({ type: 'selectProfile', profileId: profile.value });
model.onchange = () => vscode.postMessage({ type: 'selectModel', model: model.value });
const syncOptions = () => {
  const options: ChatOptions = { mode: mode.value as ChatOptions['mode'], thinking: thinking.value as ChatOptions['thinking'], approval: approval.value as ChatOptions['approval'] };
  app.querySelector('#mode-label')!.textContent = options.mode === 'planning' ? 'Planning · read only' : 'Implementation';
  input.placeholder = options.mode === 'planning' ? 'Describe the change to investigate and plan…' : 'Describe the task, constraints, and acceptance criteria…';
  vscode.postMessage({ type: 'setOptions', options });
};
mode.onchange = syncOptions; thinking.onchange = syncOptions; approval.onchange = syncOptions;
app.querySelector('#settings')!.addEventListener('click', () => vscode.postMessage({ type: 'openSettings' }));
app.querySelector('#usage-link')!.addEventListener('click', () => vscode.postMessage({ type: 'openUsage' }));
app.querySelector('#new')!.addEventListener('click', () => vscode.postMessage({ type: 'newChat' }));
app.querySelectorAll<HTMLElement>('[data-pane]').forEach(button => button.addEventListener('click', () => {
  activePane = button.dataset.pane as 'chat' | 'task'; renderPane();
}));
app.querySelector('#composer-form')!.addEventListener('submit', event => {
  event.preventDefault(); const text = input.value.trim(); if (!text || generating) return;
  clearError(); addMessage('user', text); input.value = ''; resizeInput(); vscode.postMessage({ type: 'userMessage', text });
});
input.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); (app.querySelector('#composer-form') as HTMLFormElement).requestSubmit(); } });
input.addEventListener('input', resizeInput);
stop.onclick = () => vscode.postMessage({ type: 'cancel' });

window.addEventListener('message', ({ data }: MessageEvent<unknown>) => {
  if (!isHostMessage(data)) return;
  switch (data.type) {
    case 'appearance': document.documentElement.dataset.lgsTheme = data.theme; break;
    case 'profiles':
      profile.replaceChildren(...data.profiles.map(item => option(item.id, item.name + ' · ' + item.kind)));
      profile.value = data.selected; break;
    case 'models':
      model.replaceChildren(...(data.models.length ? data.models.map(item => option(item.id, item.displayName || item.id)) : [option('', 'No models discovered')]));
      model.value = data.selected; break;
    case 'options':
      mode.value = data.options.mode; thinking.value = data.options.thinking; approval.value = data.options.approval;
      app.querySelector('#mode-label')!.textContent = data.options.mode === 'planning' ? 'Planning · read only' : 'Implementation'; break;
    case 'chatList': renderChats(data.chats); break;
    case 'chatLoaded':
      history.innerHTML = ''; dashboard = undefined; taskPanel.hidden = true; completion.hidden = true; activePane = 'chat';
      if (data.messages.length) data.messages.forEach(item => addMessage(item.role, item.text)); else renderEmpty(); renderPane(); break;
    case 'completionState': if (dashboard) dashboard.completion = data.state; renderCompletion(data.state); if (dashboard) renderDashboard(); break;
    case 'taskDashboard': dashboard = data.dashboard; app.querySelector<HTMLButtonElement>('[data-pane="task"]')!.disabled = false; renderDashboard(); break;
    case 'state':
      state.textContent = data.state; statusDot.dataset.state = /error|no enabled/i.test(data.state) ? 'error' : /connecting/i.test(data.state) ? 'busy' : 'ready'; break;
    case 'streamStart':
      generating = true; clearError(); send.disabled = true; stop.hidden = false; input.disabled = true; state.textContent = 'Advisor working…'; statusDot.dataset.state = 'busy'; currentAssistant = addMessage('assistant', '', true); break;
    case 'textDelta': if (currentAssistant) { currentAssistant.textContent += data.text; history.scrollTop = history.scrollHeight; } break;
    case 'streamEnd':
      generating = false; send.disabled = false; stop.hidden = true; input.disabled = false; currentAssistant = undefined; state.textContent = 'Ready'; statusDot.dataset.state = 'ready'; break;
    case 'error':
      showError(data.message); generating = false; send.disabled = false; stop.hidden = true; input.disabled = false; break;
  }
});

function option(value: string, label: string): HTMLOptionElement { const item = document.createElement('option'); item.value = value; item.textContent = label; return item; }
function renderChats(items: { id: string; title: string; updatedAt: number }[]): void {
  app.querySelector('#session-count')!.textContent = `${items.length} ${items.length === 1 ? 'session' : 'sessions'}`;
  chats.replaceChildren(...items.map(item => {
    const button = document.createElement('button'); button.className = 'chat-item'; button.dataset.id = item.id;
    const title = document.createElement('span'); title.textContent = item.title;
    const date = document.createElement('time'); date.textContent = relativeTime(item.updatedAt); button.append(title, date);
    button.onclick = () => vscode.postMessage({ type: 'loadChat', chatId: item.id }); return button;
  }));
  if (!items.length) { const empty = document.createElement('p'); empty.className = 'sessions-empty'; empty.textContent = 'Completed and active tasks will appear here.'; chats.append(empty); }
}
function renderEmpty(): void {
  history.innerHTML = '<div class="empty"><div class="folio" aria-hidden="true"><span>LGS</span></div><h1>Begin an investigation</h1><p>Describe the engineering outcome and what evidence should prove it complete.</p><div class="empty-cues"><span>Repository-aware</span><span>Evidence-gated</span><span>Provider-neutral</span></div></div>';
}
function renderPane(): void {
  app.querySelectorAll<HTMLElement>('[data-pane]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.pane === activePane)));
  history.hidden = activePane !== 'chat'; taskPanel.hidden = activePane !== 'task' || !dashboard;
}
function renderDashboard(): void {
  if (!dashboard) { taskPanel.hidden = true; return; }
  const required = dashboard.completion?.progress.required || 0; const passed = dashboard.completion?.progress.passed || 0;
  const progress = required ? Math.round(passed / required * 100) : 0;
  const tabs = [['overview', 'Overview'], ['plan', 'Plan'], ['agents', 'Agents'], ['evidence', 'Evidence'], ['usage', 'Usage']];
  const detail = activeTaskTab === 'overview'
    ? sectionList('Acceptance criteria', dashboard.acceptanceCriteria, 'The Advisor has not recorded acceptance criteria yet.') + sectionList('Completed work', dashboard.completed, 'No work is recorded complete.') + sectionList('Remaining', dashboard.remaining, 'No remaining work is recorded.')
    : activeTaskTab === 'plan' ? sectionList('Current plan', dashboard.plan, 'The task plan has not been recorded.') + sectionList('Changed files', dashboard.files, 'No task changes are recorded.')
    : activeTaskTab === 'agents' ? (dashboard.agents.map(agent => `<article class="agent-card"><span class="agent-role">${escapeHtml(agent.role)}</span><b>${escapeHtml(agent.model)}</b><small>${escapeHtml(agent.profile)} · ${escapeHtml(agent.state)}</small></article>`).join('') || '<p class="quiet">No logical worker agents have been assigned.</p>')
    : activeTaskTab === 'evidence' ? evidenceView()
    : usageView();
  taskPanel.innerHTML = `<div class="task-hero"><div><span class="eyebrow">Active task · ${escapeHtml(dashboard.taskId)}</span><h1>${escapeHtml(dashboard.objective)}</h1><p>${escapeHtml(dashboard.advisor.model)} · ${escapeHtml(dashboard.advisor.profile)}</p></div><div class="progress-ring" style="--progress:${progress * 3.6}deg"><span>${progress}%</span></div></div><div class="task-facts"><span><b>${dashboard.files.length}</b> files</span><span><b>${dashboard.researchCount}</b> sources</span><span><b>${dashboard.review.findings}</b> findings</span><span><b>${passed}/${required || '—'}</b> gates</span></div><nav class="task-tabs">${tabs.map(([id, label]) => `<button data-task-tab="${id}" aria-selected="${id === activeTaskTab}">${label}</button>`).join('')}</nav><div class="task-detail">${detail}</div><section class="activity"><div class="section-heading"><h2>Observable activity</h2><span>${dashboard.activities.length} events</span></div>${dashboard.activities.length ? dashboard.activities.slice(0, 12).map(item => `<div class="activity-item ${item.status}"><i></i><div><b>${escapeHtml(item.label)}</b><span>${escapeHtml(item.detail)}</span></div><time>${relativeTime(Date.parse(item.at))}</time></div>`).join('') : '<p class="quiet">Tool and evidence events will appear here as they occur.</p>'}</section>`;
  taskPanel.querySelectorAll<HTMLElement>('[data-task-tab]').forEach(button => button.onclick = () => { activeTaskTab = button.dataset.taskTab || 'overview'; renderDashboard(); });
  taskPanel.querySelectorAll<HTMLElement>('[data-action]').forEach(button => button.onclick = () => vscode.postMessage({ type: 'taskAction', action: button.dataset.action as Extract<ClientMessage, { type: 'taskAction' }>['action'] }));
  taskPanel.querySelector<HTMLElement>('#open-usage-detail')?.addEventListener('click', () => vscode.postMessage({ type: 'openUsage' }));
  renderPane();
}
function evidenceView(): string {
  const checks = dashboard?.completion?.checklist.filter(item => item.required) || [];
  return `<div class="evidence-actions"><button data-action="viewDiff">Source Control</button><button data-action="viewTaskState">Task state</button><button data-action="viewResearch">Research</button><button data-action="viewLogs">Execution logs</button></div><div class="evidence-list">${checks.length ? checks.map(item => `<div class="evidence-row ${item.passed ? 'passed' : 'blocked'}"><span>${item.passed ? '✓' : '○'}</span><div><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.detail)}</small></div></div>`).join('') : '<p class="quiet">Completion Guard has not evaluated this task yet.</p>'}</div>`;
}
function usageView(): string {
  const usage = dashboard!.usage; return `<div class="metric-grid"><article><span>Context</span><b>${formatNumber(usage.context)}${usage.contextMaximum ? ` / ${formatNumber(usage.contextMaximum)}` : ''}</b></article><article><span>Tokens</span><b>${formatNumber(usage.tokens)}</b></article><article><span>Generation</span><b>${usage.tokensPerSecond === undefined ? 'Unknown' : usage.tokensPerSecond.toFixed(1) + ' tok/s'}</b></article><article><span>Recorded cost</span><b>${usage.cost === undefined ? 'Unknown' : '$' + usage.cost.toFixed(4)}</b></article></div><button class="text-action" id="open-usage-detail">Open full usage dashboard</button>`;
}
function sectionList(title: string, items: string[], empty: string): string { return `<section class="detail-list"><h2>${escapeHtml(title)}</h2>${items.length ? `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : `<p class="quiet">${escapeHtml(empty)}</p>`}</section>`; }
function renderCompletion(view: Extract<import('../shared/messages.js').HostMessage, { type: 'completionState' }>['state']): void {
  completion.hidden = false; completion.dataset.status = view.status; completionProgress.textContent = `${view.progress.passed}/${view.progress.required}`;
  completionChecklist.replaceChildren(...view.checklist.filter(item => item.required).map(item => {
    const row = document.createElement('div'); row.className = 'completion-item ' + (item.passed ? 'passed' : 'blocked');
    const mark = document.createElement('span'); mark.textContent = item.passed ? '✓' : '○'; const text = document.createElement('div');
    const label = document.createElement('b'); label.textContent = item.label; const detail = document.createElement('small'); detail.textContent = item.detail;
    text.append(label, detail); row.append(mark, text); return row;
  }));
}
function addMessage(kind: string, text: string, loading = false): HTMLElement {
  history.querySelector('.empty')?.remove(); const wrapper = document.createElement('article'); wrapper.className = `message-row ${kind}`;
  const label = document.createElement('span'); label.className = 'message-label'; label.textContent = kind === 'user' ? 'You' : kind === 'assistant' ? 'Advisor' : 'LGS';
  const item = document.createElement('div'); item.className = 'message'; item.textContent = text; if (loading) item.classList.add('streaming');
  wrapper.append(label, item); history.append(wrapper); history.scrollTop = history.scrollHeight; return item;
}
function showError(message: string): void {
  const box = document.createElement('div'); box.className = 'error-banner'; box.setAttribute('role', 'alert');
  const content = document.createElement('div'); const title = document.createElement('b'); title.textContent = 'LGS could not continue'; const detail = document.createElement('span'); detail.textContent = message; content.append(title, detail);
  const close = document.createElement('button'); close.textContent = 'Dismiss'; close.onclick = () => box.remove(); box.append(content, close); errorRegion.replaceChildren(box);
}
function clearError(): void { errorRegion.replaceChildren(); }
function resizeInput(): void { input.style.height = 'auto'; input.style.height = Math.min(160, Math.max(54, input.scrollHeight)) + 'px'; }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character); }
function formatNumber(value: number): string { return value >= 1_000_000 ? (value / 1_000_000).toFixed(1) + 'M' : value >= 1000 ? (value / 1000).toFixed(value % 1000 ? 1 : 0) + 'K' : String(value); }
function relativeTime(timestamp: number): string { const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000)); return minutes < 1 ? 'now' : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`; }

vscode.postMessage({ type: 'ready' });
