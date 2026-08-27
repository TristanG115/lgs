import './styles.css';
import { isHostMessage, type ChatOptions, type ClientMessage, type ComposerAttachment, type TaskDashboard } from '../shared/messages.js';

declare const acquireVsCodeApi: () => { postMessage(message: ClientMessage): void };
const vscode = acquireVsCodeApi();
const app = document.querySelector<HTMLDivElement>('#app')!;
let generating = false;
let currentAssistant: HTMLElement | undefined;
let dashboard: TaskDashboard | undefined;
let activeTaskTab = 'overview';
let activePane: 'chat' | 'task' = 'chat';
let attachments: ComposerAttachment[] = [];

app.innerHTML = `
  <div class="lab-shell">
    <header class="topbar">
      <div class="identity"><span class="seal" aria-hidden="true">L</span><span><b>LGS</b></span></div>
      <div class="header-actions">
        <button class="icon-button" id="new" aria-label="New task" title="New task">+</button>
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
        <p>Ask LGS to do something…</p>
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
        <label><span>Mode</span><select id="mode" aria-label="Task mode"><option value="chat">Chat</option><option value="plan">Plan · read only</option><option value="implement">Implement</option><option value="research">Research</option><option value="review">Review</option></select></label>
        <label><span>Reasoning</span><select id="thinking" aria-label="Reasoning effort"><option value="auto">Auto</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select><small id="reasoning-support">Provider support is checked per model.</small></label>
        <label><span>Auto Research</span><select id="auto-research" aria-label="Auto Research"><option value="off">Off</option><option value="when-uncertain">When uncertain</option><option value="proactive">Proactive</option></select></label>
        <label><span>Commands</span><select id="approval" aria-label="Command approval"><option value="always">Use allowed commands</option><option value="on-request">Ask when required</option><option value="never">Deny commands</option></select></label>
        <fieldset class="capabilities"><legend>Capabilities</legend>${['web','code','terminal','browser','computer','integrations'].map(value => `<label><input type="checkbox" data-capability="${value}" checked> ${value}</label>`).join('')}</fieldset>
      </div>
      <form id="composer-form">
        <div id="attachment-chips" class="attachment-chips" aria-live="polite"></div>
        <textarea id="input" rows="2" maxlength="4000" placeholder="Describe the task, constraints, and acceptance criteria…" aria-label="Task objective"></textarea>
        <input id="attachment-input" type="file" multiple hidden>
        <div class="composer-bottom"><div><button id="attach" class="attach-button" type="button" aria-label="Add context" title="Attach files, images, documents, or code">+</button><span id="composer-hint">Ctrl/⌘ Enter</span></div><div><button id="stop" class="stop-button" type="button" aria-label="Stop generation" hidden>Stop</button><button id="send" class="send-button" type="submit" aria-label="Send task"><span>Send</span><b>↑</b></button></div></div>
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
const autoResearch = app.querySelector<HTMLSelectElement>('#auto-research')!;
const attachmentInput = app.querySelector<HTMLInputElement>('#attachment-input')!;
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
  const capabilities = Object.fromEntries(Array.from(app.querySelectorAll<HTMLInputElement>('[data-capability]')).map(item => [item.dataset.capability!, item.checked])) as ChatOptions['capabilities'];
  const options: ChatOptions = { mode: mode.value as ChatOptions['mode'], thinking: thinking.value as ChatOptions['thinking'], autoResearch: autoResearch.value as ChatOptions['autoResearch'], capabilities, approval: approval.value as ChatOptions['approval'] };
  app.querySelector('#mode-label')!.textContent = options.mode === 'plan' ? 'Plan · read only' : options.mode[0].toUpperCase() + options.mode.slice(1);
  input.placeholder = options.mode === 'plan' ? 'Describe the change to investigate and plan…' : options.mode === 'research' ? 'State the research question and desired evidence…' : 'Describe the task, constraints, and acceptance criteria…';
  vscode.postMessage({ type: 'setOptions', options });
};
mode.onchange = syncOptions; thinking.onchange = syncOptions; autoResearch.onchange = syncOptions; approval.onchange = syncOptions;
app.querySelectorAll<HTMLInputElement>('[data-capability]').forEach(item => item.onchange = syncOptions);
app.querySelector('#settings')!.addEventListener('click', () => vscode.postMessage({ type: 'openSettings' }));
app.querySelector('#usage-link')!.addEventListener('click', () => vscode.postMessage({ type: 'openUsage' }));
app.querySelector('#new')!.addEventListener('click', () => vscode.postMessage({ type: 'newChat' }));
app.querySelectorAll<HTMLElement>('[data-pane]').forEach(button => button.addEventListener('click', () => {
  activePane = button.dataset.pane as 'chat' | 'task'; renderPane();
}));
app.querySelector('#composer-form')!.addEventListener('submit', event => {
  event.preventDefault(); const text = input.value.trim(); if (!text || generating) return;
  clearError(); addMessage('user', text); input.value = ''; resizeInput(); vscode.postMessage({ type: 'userMessage', text, attachments }); attachments = []; renderAttachments();
});
input.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); (app.querySelector('#composer-form') as HTMLFormElement).requestSubmit(); } });
input.addEventListener('input', resizeInput);
stop.onclick = () => vscode.postMessage({ type: 'cancel' });
app.querySelector('#attach')!.addEventListener('click', () => attachmentInput.click());
attachmentInput.addEventListener('change', () => { void addFiles(attachmentInput.files, 'composer'); attachmentInput.value = ''; });
app.querySelector('.composer')!.addEventListener('dragover', event => { event.preventDefault(); });
app.querySelector('.composer')!.addEventListener('drop', event => { event.preventDefault(); void addFiles((event as DragEvent).dataTransfer?.files, 'drop'); });
input.addEventListener('paste', event => { const files = event.clipboardData?.files; if (files?.length) { event.preventDefault(); void addFiles(files, 'clipboard'); } });

window.addEventListener('message', ({ data }: MessageEvent<unknown>) => {
  if (!isHostMessage(data)) return;
  switch (data.type) {
    case 'appearance': document.documentElement.dataset.lgsTheme = data.theme; break;
    case 'profiles':
      profile.replaceChildren(...data.profiles.map(item => option(item.id, item.name + ' · ' + item.kind)));
      profile.value = data.selected; break;
    case 'models':
      model.replaceChildren(...(data.models.length ? data.models.map(item => option(item.id, item.displayName || item.id)) : [option('', 'No models discovered')]));
      model.value = data.selected; updateReasoningSupport(data.models.find(item => item.id === data.selected)?.reasoning); break;
    case 'options':
      mode.value = data.options.mode; thinking.value = data.options.thinking; autoResearch.value = data.options.autoResearch; approval.value = data.options.approval;
      Object.entries(data.options.capabilities).forEach(([key, enabled]) => { const control = app.querySelector<HTMLInputElement>(`[data-capability="${key}"]`); if (control) control.checked = enabled; });
      app.querySelector('#mode-label')!.textContent = data.options.mode === 'plan' ? 'Plan · read only' : data.options.mode[0].toUpperCase() + data.options.mode.slice(1); break;
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
  history.innerHTML = '<div class="empty"><p>Ask LGS to do something…</p></div>';
}
function renderPane(): void {
  app.querySelectorAll<HTMLElement>('[data-pane]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.pane === activePane)));
  history.hidden = activePane !== 'chat'; taskPanel.hidden = activePane !== 'task' || !dashboard;
}
function renderDashboard(): void {
  if (!dashboard) { taskPanel.hidden = true; return; }
  const required = dashboard.completion?.progress.required || 0; const passed = dashboard.completion?.progress.passed || 0;
  const progress = required ? Math.round(passed / required * 100) : 0;
  const tabs = [['overview', 'Overview'], ['plan', 'Plan'], ['research', 'Research'], ['context', 'Context'], ['agents', 'Agents'], ['evidence', 'Evidence'], ['usage', 'Usage']];
  const detail = activeTaskTab === 'overview'
    ? sectionList('Acceptance criteria', dashboard.acceptanceCriteria, 'The Advisor has not recorded acceptance criteria yet.') + sectionList('Completed work', dashboard.completed, 'No work is recorded complete.') + sectionList('Remaining', dashboard.remaining, 'No remaining work is recorded.')
    : activeTaskTab === 'plan' ? planView()
    : activeTaskTab === 'research' ? researchView()
    : activeTaskTab === 'context' ? contextView()
    : activeTaskTab === 'agents' ? (dashboard.agents.map(agent => `<article class="agent-card"><span class="agent-role">${escapeHtml(agent.role)}</span><b>${escapeHtml(agent.model)}</b><small>${escapeHtml(agent.profile)} · ${escapeHtml(agent.state)}</small></article>`).join('') || '<p class="quiet">No logical worker agents have been assigned.</p>')
    : activeTaskTab === 'evidence' ? evidenceView()
    : usageView();
  taskPanel.innerHTML = `<div class="task-hero"><div><span class="eyebrow">Active task · ${escapeHtml(dashboard.taskId)}</span><h1>${escapeHtml(dashboard.objective)}</h1><p>${escapeHtml(dashboard.advisor.model)} · ${escapeHtml(dashboard.advisor.profile)}</p></div><div class="progress-ring" style="--progress:${progress * 3.6}deg"><span>${progress}%</span></div></div><div class="task-facts"><span><b>${dashboard.files.length}</b> files</span><span><b>${dashboard.researchCount}</b> sources</span><span><b>${dashboard.review.findings}</b> findings</span><span><b>${passed}/${required || '—'}</b> gates</span></div><nav class="task-tabs">${tabs.map(([id, label]) => `<button data-task-tab="${id}" aria-selected="${id === activeTaskTab}">${label}</button>`).join('')}</nav><div class="task-detail">${detail}</div><section class="activity"><div class="section-heading"><h2>Observable activity</h2><span>${dashboard.activities.length} events</span></div>${dashboard.activities.length ? dashboard.activities.slice(0, 12).map(item => `<div class="activity-item ${item.status}"><i></i><div><b>${escapeHtml(item.label)}</b><span>${escapeHtml(item.detail)}</span></div><time>${relativeTime(Date.parse(item.at))}</time></div>`).join('') : '<p class="quiet">Tool and evidence events will appear here as they occur.</p>'}</section>`;
  taskPanel.querySelectorAll<HTMLElement>('[data-task-tab]').forEach(button => button.onclick = () => { activeTaskTab = button.dataset.taskTab || 'overview'; renderDashboard(); });
  taskPanel.querySelectorAll<HTMLElement>('[data-action]').forEach(button => button.onclick = () => vscode.postMessage({ type: 'taskAction', action: button.dataset.action as Extract<ClientMessage, { type: 'taskAction' }>['action'] }));
  taskPanel.querySelector<HTMLElement>('#open-usage-detail')?.addEventListener('click', () => vscode.postMessage({ type: 'openUsage' }));
  renderPane();
}

function researchView(): string {
  const research = dashboard?.research; if (!research) return '<p class="quiet">No Research Notebook has been created.</p>';
  const active = [...research.cycles].reverse().find(item => item.status === 'active');
  return `<div class="notebook-view"><span class="eyebrow">${escapeHtml(research.status)}</span><h2>${escapeHtml(research.researchQuestion)}</h2>${active ? `<article class="hypothesis"><b>Active hypothesis · ${Math.round(active.confidence * 100)}%</b><p>${escapeHtml(active.hypothesis)}</p><small>${escapeHtml(active.experiment.proposedExperiment)}</small></article>` : '<p class="quiet">No experiment is active.</p>'}${sectionList('Established evidence', research.establishedFacts.map(item => `[${item.state}] ${item.claim}`), 'No established facts.')}${sectionList('Previous experiments', research.experiments.map(item => `#${item.sequence} ${item.status} · ${item.conclusion || 'pending'} · ${item.learned || item.proposedExperiment}`), 'No experiments recorded.')}${sectionList('Rejected approaches', research.rejectedApproaches, 'No approaches rejected.')}<button class="text-action" data-action="viewResearch">Open RESEARCH.md</button></div>`;
}
function planView(): string {
  const plan = dashboard?.planArtifact; if (!plan) return sectionList('Current plan', dashboard?.plan ?? [], 'The task plan has not been recorded.');
  const revisions = plan.revisions.map(item => `Revision ${item.revision}: ${item.changed} - ${item.reason}`);
  return `<div class="plan-actions"><button data-action="viewPlan">Open PLAN.md</button><button data-action="editPlan">Edit</button><button data-action="approvePlan" ${plan.status === 'approved' ? 'disabled' : ''}>Approve</button><button data-action="regeneratePlan">Regenerate</button><button data-action="beginImplementation" ${plan.status !== 'approved' && plan.handoff === 'wait-for-approval' ? 'disabled' : ''}>Begin implementation</button></div>${sectionList('Implementation stages', plan.implementationStages, 'No stages recorded.')}${sectionList('Verification plan', plan.verificationPlan, 'No verification recorded.')}${sectionList('Risks', plan.risks, 'No risks recorded.')}${sectionList('Revision history', revisions, 'No revisions recorded.')}`;
}
function contextView(): string {
  const context = dashboard?.contextLifecycle; if (!context) return '<p class="quiet">Context lifecycle metrics are not available yet.</p>';
  return `<div class="metric-grid"><article><span>Current context</span><b>${context.contextTokens.toLocaleString()} / ${context.contextMaximum.toLocaleString()}</b></article><article><span>Utilization</span><b>${context.utilizationPercent}%</b></article><article><span>Compaction</span><b>${escapeHtml(context.compactionStatus)}</b></article><article><span>Rotations</span><b>${context.rotations}</b></article><article><span>Persistent knowledge</span><b>${context.persistentKnowledgeBytes.toLocaleString()} bytes</b></article><article><span>Tokens saved</span><b>${context.compactedTokensSaved.toLocaleString()}</b></article></div>`;
}

async function addFiles(files: FileList | null | undefined, source: ComposerAttachment['source']): Promise<void> {
  if (!files) return;
  for (const file of Array.from(files).slice(0, 20 - attachments.length)) {
    if (file.size > 25 * 1024 * 1024) { showError(`${file.name} exceeds the 25 MB attachment limit.`); continue; }
    const dataBase64 = await fileBase64(file); attachments.push({ id: crypto.randomUUID(), name: file.name, mediaType: file.type || 'application/octet-stream', bytes: file.size, dataBase64, source });
  }
  renderAttachments();
}
function fileBase64(file: File): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.readAsDataURL(file); }); }
function renderAttachments(): void { const target = app.querySelector<HTMLElement>('#attachment-chips')!; target.replaceChildren(...attachments.map(item => { const chip = document.createElement('span'); chip.className = 'attachment-chip'; chip.textContent = `${item.name} · ${formatBytes(item.bytes)}`; const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove ${item.name}`); remove.onclick = () => { attachments = attachments.filter(value => value.id !== item.id); renderAttachments(); }; chip.append(remove); return chip; })); }
function updateReasoningSupport(supported: boolean | undefined): void { const label = app.querySelector<HTMLElement>('#reasoning-support')!; label.textContent = supported === false ? 'Unavailable for selected model.' : supported === true ? 'Supported by selected model.' : 'Support not advertised; Auto omits parameters.'; thinking.title = label.textContent; }
function formatBytes(value: number): string { return value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${Math.round(value / 1024)} KB` : `${Math.round(value / 1024 / 1024 * 10) / 10} MB`; }
function evidenceView(): string {
  const checks = dashboard?.completion?.checklist.filter(item => item.required) || [];
  return `<div class="evidence-actions"><button data-action="viewDiff">Source Control</button><button data-action="viewTaskState">Task state</button><button data-action="viewResearch">Research</button><button data-action="viewLogs">Execution logs</button></div><div class="evidence-list">${checks.length ? checks.map(item => `<div class="evidence-row ${item.passed ? 'passed' : 'blocked'}"><span>${item.passed ? '✓' : '○'}</span><div><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.detail)}</small></div></div>`).join('') : '<p class="quiet">Completion Guard has not evaluated this task yet.</p>'}</div>`;
}
function usageView(): string {
  const usage = dashboard!.usage; const details = dashboard!.usageDetails; return `<div class="metric-grid"><article><span>Context</span><b>${formatNumber(usage.context)}${usage.contextMaximum ? ` / ${formatNumber(usage.contextMaximum)}` : ''}</b></article><article><span>Tokens</span><b>${formatNumber(usage.tokens)}</b></article><article><span>Generation</span><b>${usage.tokensPerSecond === undefined ? 'Unknown' : usage.tokensPerSecond.toFixed(1) + ' tok/s'}</b></article><article><span>Recorded cost</span><b>${usage.cost === undefined ? 'Unknown' : '$' + usage.cost.toFixed(4)}</b></article>${details ? `<article><span>Research searches</span><b>${details.searches}</b></article><article><span>Context rotations</span><b>${details.rotations}</b></article><article><span>Compaction saved</span><b>${formatNumber(details.compactionSaved)}</b></article>` : ''}</div>${details ? sectionList('Agent usage', details.byAgent.map(item => `${item.agent}: ${formatNumber(item.tokens)} tokens${item.cost === undefined ? '' : ` · $${item.cost.toFixed(4)}`}`), 'No agent usage recorded.') : ''}<button class="text-action" id="open-usage-detail">Open full usage dashboard</button>`;
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
