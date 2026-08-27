import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getFreshness, writeRepositoryIndex, type RepositoryIndex } from './intelligence/indexer.js';
import type { ModelBackend } from './model/backend.js';
import { createBackends } from './model/registry.js';
import { loadProfiles, type BackendProfile, type ProviderDataPolicy } from './model/profiles.js';
import { textFromMessage, textMessage, type LgsMessage } from './model/types.js';
import { SettingsManager } from './settings/configuration.js';
import { SettingsPanel } from './settings/panel.js';
import { Logger } from './shared/logger.js';
import { parseClientMessage, type ChatOptions, type HostMessage, type TaskActivity, type TaskAction, type TaskDashboard } from './shared/messages.js';
import {
  BackendAgentInference, BackendDocumentationAnalyzer, BackendReviewerAnalyzer, BackendWatchdogAnalyzer,
  CommandExecutionService, CommandPermissionResolver, CompletionGuard, ComputerAgent, createWorkspaceToolRegistry,
  displayCommand, DocumentationAgent, EscalationController, FileCompletionEvidenceStore, FileDocumentationAuditStore,
  FileEditService,
  FileResearchStore, FileReviewStore, FileRoutingDecisionStore, FileRuntimeStore, FileTaskEvidenceStore,
  FileTaskStateStore, GitBaselineStore, HttpResearchProvider, IndependentReviewer, IntegrationHub,
  ManagedProcessManager, ModelRouter, Orchestrator, RawExecutionLogStore, ResearchService, RoutedToolLoopModel,
  RuleBasedWatchdogAnalyzer, runToolLoop, RuntimeVerifier, ToolExecutor, VerificationRunner, WatchdogService,
  type GitBaseline, type PermissionConfiguration, type ToolAuditRecord,
} from './tools/index.js';
import { FilePricingStore, FileUsageStore, setActiveUsageTracker, UsageTracker } from './usage/index.js';
import { UsageDashboardPanel } from './usage/panel.js';

type SavedChat = { id: string; title: string; updatedAt: number; messages: LgsMessage[] };

export function activate(context: vscode.ExtensionContext): void {
  const logger = new Logger('LGS');
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const settings = new SettingsManager(context, root);
  const pricing = root ? new FilePricingStore(root) : undefined;
  const usage = root && pricing ? new UsageTracker(new FileUsageStore(root), pricing, settings.workspaceConfiguration().usage) : undefined;
  setActiveUsageTracker(usage, id => loadProfiles(context).find(profile => profile.id === id)?.dataPolicy === 'local' ? 'local' : 'unknown');
  const provider = new LgsViewProvider(context, logger, settings, usage, pricing);
  const settingsPanel = new SettingsPanel(context, settings, () => provider.refreshConnections(), () => provider.refreshSettings());
  provider.attachSettingsPanel(settingsPanel);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('lgs.sidebar', provider),
    vscode.commands.registerCommand('lgs.open', () => vscode.commands.executeCommand('workbench.view.extension.lgs')),
    vscode.commands.registerCommand('lgs.settings', () => settingsPanel.show()),
    vscode.commands.registerCommand('lgs.rebuildIndex', () => rebuildIndex(logger, true)),
    vscode.commands.registerCommand('lgs.openCodebaseMap', () => openCodebaseMap()),
    vscode.commands.registerCommand('lgs.openUsage', () => usage ? new UsageDashboardPanel(usage).show() : vscode.window.showWarningMessage('LGS: Open a workspace to view usage.')),
  );
  logger.info('Extension activated');
  void rebuildIndex(logger, false);
}

export function deactivate(): void {}

class LgsViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private profiles: BackendProfile[];
  private backends = new Map<string, ModelBackend>();
  private profileId = '';
  private model = '';
  private history: LgsMessage[] = [];
  private abort?: AbortController;
  private options: ChatOptions = { mode: 'implementation', thinking: 'off', approval: 'on-request' };
  private chats: SavedChat[];
  private chatId = '';
  private gitBaselines: GitBaselineStore;
  private activities: TaskActivity[] = [];
  private completion?: TaskDashboard['completion'];
  private settingsPanel?: SettingsPanel;
  private rebuilding?: Promise<void>;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logger: Logger,
    private readonly settings: SettingsManager,
    private readonly usage?: UsageTracker,
    private readonly pricing?: FilePricingStore,
  ) {
    this.profiles = loadProfiles(context);
    this.chats = context.globalState.get<SavedChat[]>('lgs.chats') || [];
    this.gitBaselines = new GitBaselineStore(context.globalState.get<Record<string, GitBaseline>>('lgs.gitBaselines') || {});
    this.selectConfiguredDefaults();
  }

  attachSettingsPanel(panel: SettingsPanel): void { this.settingsPanel = panel; }

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.context.extensionUri] };
    view.webview.onDidReceiveMessage((raw: unknown) => void this.receive(raw), undefined, this.context.subscriptions);
    this.rebuilding = this.rebuild();
    view.webview.html = getHtml(view.webview, this.context.extensionUri);
    await this.rebuilding;
  }

  private selectConfiguredDefaults(): void {
    const effective = Object.fromEntries(this.settings.effective().map(setting => [setting.id, setting.value]));
    const preferred = String(effective['models.defaultConnection'] || '');
    this.profileId = this.profiles.some(profile => profile.id === preferred) ? preferred : this.profiles[0]?.id || '';
  }

  private async rebuild(): Promise<void> {
    const secrets = new Map<string, string>(); const secretHeaders = new Map<string, Record<string, string>>();
    for (const profile of this.profiles) {
      if (profile.secretName) { const secret = await this.context.secrets.get(profile.secretName); if (secret) secrets.set(profile.secretName, secret); }
      const headers: Record<string, string> = {};
      for (const name of profile.secretHeaderNames) {
        const value = await this.context.secrets.get(`lgs.connection.${profile.id}.header.${name}`); if (value) headers[name] = value;
      }
      secretHeaders.set(profile.id, headers);
    }
    this.backends = createBackends(this.profiles, profile => profile.secretName ? secrets.get(profile.secretName) : undefined, profile => secretHeaders.get(profile.id) || {});
  }

  private send(message: HostMessage): void { void this.view?.webview.postMessage(message); }
  private backend(): ModelBackend | undefined { return this.backends.get(this.profileId); }
  private sendProfiles(): void { this.send({ type: 'profiles', profiles: this.profiles.map(profile => ({ id: profile.id, name: profile.name, kind: profile.kind })), selected: this.profileId }); }
  private sendChats(): void { this.send({ type: 'chatList', chats: this.chats.map(chat => ({ id: chat.id, title: chat.title, updatedAt: chat.updatedAt })) }); }

  private async receive(raw: unknown): Promise<void> {
    const message = parseClientMessage(raw);
    if (!message) { this.send({ type: 'error', message: 'LGS rejected an invalid UI request.' }); return; }
    if (message.type === 'ready') {
      await this.rebuilding;
      this.sendProfiles(); this.send({ type: 'options', options: this.options }); this.refreshAppearance(); this.sendChats();
      await this.listModels(); return;
    }
    if (message.type === 'cancel') { this.abort?.abort(); return; }
    if (message.type === 'openSettings') { this.settingsPanel?.show(); return; }
    if (message.type === 'openUsage') { await vscode.commands.executeCommand('lgs.openUsage'); return; }
    if (message.type === 'taskAction') { await this.taskAction(message.action); return; }
    if (message.type === 'newChat') {
      this.history = []; this.chatId = ''; this.activities = []; this.completion = undefined;
      this.send({ type: 'chatLoaded', messages: [] }); return;
    }
    if (message.type === 'loadChat') {
      const chat = this.chats.find(candidate => candidate.id === message.chatId);
      if (chat) {
        this.chatId = chat.id; this.history = chat.messages; this.activities = []; this.completion = undefined;
        this.send({ type: 'chatLoaded', messages: chat.messages.filter(item => item.role !== 'system').map(item => ({ role: item.role as 'user' | 'assistant', text: item.content.map(part => part.type === 'text' ? part.text : '[image]').join('') })) });
        this.restoreDashboard();
      }
      return;
    }
    if (message.type === 'selectProfile') {
      if (this.backends.has(message.profileId)) { this.profileId = message.profileId; this.model = ''; this.sendProfiles(); await this.listModels(); }
      return;
    }
    if (message.type === 'selectModel') { this.model = message.model; return; }
    if (message.type === 'setOptions') { this.options = message.options; this.send({ type: 'options', options: this.options }); return; }
    if (message.type === 'listModels') { await this.listModels(); return; }
    if (message.type === 'userMessage') {
      if (!this.model) { await this.listModels(); if (!this.model) { this.send({ type: 'error', message: 'No model is available for this connection. Open Settings to test the endpoint and discover models.' }); return; } }
      this.history.push(textMessage('user', message.text)); await this.generate();
    }
  }

  private async listModels(): Promise<void> {
    const backend = this.backend();
    if (!backend) { this.send({ type: 'models', models: [], selected: '' }); this.send({ type: 'state', state: 'No enabled connection' }); return; }
    this.send({ type: 'state', state: 'Connecting…' });
    try {
      const models = await backend.listModels();
      const preferred = String(this.settings.effective().find(setting => setting.id === 'models.defaultModel')?.value || '');
      this.model = models.some(model => model.id === this.model) ? this.model : models.some(model => model.id === preferred) ? preferred : models[0]?.id || '';
      this.send({ type: 'models', models, selected: this.model });
      this.send({ type: 'state', state: models.length ? 'Ready' : 'Connected · no models' });
    } catch (error) {
      this.send({ type: 'models', models: [], selected: '' });
      this.send({ type: 'error', message: error instanceof Error ? error.message : 'Unable to connect or discover models.' });
      this.send({ type: 'state', state: 'Connection error' });
    }
  }

  private async generate(): Promise<void> {
    this.settings.reloadWorkspace(); const project = this.settings.workspaceConfiguration();
    if (!this.chatId) this.chatId = Date.now().toString(36);
    const fallback = { profileId: this.profileId, model: this.model };
    const route = new ModelRouter(project.routing, id => providerPolicy(this.profiles.find(profile => profile.id === id)?.dataPolicy), request => this.usage?.budgetDecision(request.taskId)).route({
      role: 'manager', fallback, roleModel: project.agents.roleModels.manager, needsTools: true, taskId: this.chatId,
    });
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) new FileRoutingDecisionStore(workspaceRoot).record(this.chatId, route);
    if (route.blocked) { this.send({ type: 'error', message: route.reason }); return; }
    const managerProfileId = route.identity.profileId; const managerModel = route.identity.model;
    const backend = this.backends.get(managerProfileId);
    if (!backend) { this.send({ type: 'error', message: `Manager connection was not found: ${managerProfileId}.` }); return; }
    this.abort = new AbortController(); this.send({ type: 'streamStart', backend: backend.displayName, model: managerModel });
    this.activities.unshift({ label: 'Advisor started', detail: route.reason, status: 'active', at: new Date().toISOString() });
    let answer = ''; let runtimeVerifier: RuntimeVerifier | undefined;
    const generation = {
      temperature: this.options.thinking === 'high' ? 0.8 : this.options.thinking === 'low' ? 0.2 : 0.5,
      maxTokens: 1024,
      reasoning: { enabled: this.options.thinking !== 'off', ...(this.options.thinking === 'off' ? {} : { effort: this.options.thinking }) },
    };
    try {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        for await (const event of backend.streamChat(managerModel, this.history, generation, this.abort.signal)) {
          if (event.type === 'textDelta') { answer += event.text; this.send(event); }
          else if (event.type === 'error') this.send({ type: 'error', message: event.error.message });
        }
      } else {
        const root = folder.uri.fsPath;
        const baseline = await this.gitBaselines.ensure(this.chatId, root, this.abort.signal);
        await this.context.globalState.update('lgs.gitBaselines', this.gitBaselines.serialize());
        const commandFallback = this.options.approval === 'always' ? 'always_allow' : this.options.approval === 'never' ? 'deny' : 'ask';
        const permissionResolver = new CommandPermissionResolver(this.context.globalState.get<PermissionConfiguration>('lgs.commandPermissions') || {}, project.permissions, commandFallback);
        const logs = new RawExecutionLogStore(root); const taskEvidence = new FileTaskEvidenceStore(root); const taskState = new FileTaskStateStore(root);
        taskState.ensure(this.chatId, textFromMessage(this.history.find(message => message.role === 'user')!));
        const documentationStore = new FileDocumentationAuditStore(root, taskState); const researchStore = new FileResearchStore(root);
        const reviewStore = new FileReviewStore(root, documentationStore, taskEvidence, researchStore); const completionEvidence = new FileCompletionEvidenceStore(root);
        const execution = new CommandExecutionService(root, permissionResolver, logs, taskEvidence, async request => {
          const choice = await vscode.window.showWarningMessage(`LGS wants to run ${displayCommand(request)} (${request.category}).`, { modal: true, detail: 'The executable is launched directly without a shell.' }, 'Allow once');
          return choice === 'Allow once';
        });
        const editing = new FileEditService(root, async request => {
          const resolution = permissionResolver.resolve({ executable: 'lgs-workspace-edit', args: [], category: 'dangerous', taskId: this.chatId });
          if (resolution.policy === 'always_allow') return true;
          if (resolution.policy === 'deny') return false;
          const target = request.destination ? `${request.path} → ${request.destination}` : request.path;
          const choice = await vscode.window.showWarningMessage(
            `LGS wants to ${request.operation} ${target}.`,
            { modal: true, detail: 'The operation is workspace-scoped, recorded in task evidence, and protected by file fingerprints.' },
            'Allow once',
          );
          return choice === 'Allow once';
        }, taskState);
        const runtimeStore = new FileRuntimeStore(root); const processes = new ManagedProcessManager(root, execution);
        runtimeVerifier = new RuntimeVerifier(project.runtime, processes, runtimeStore, root);
        const completionGuard = new CompletionGuard(root, project.completion, completionEvidence, taskEvidence, documentationStore, reviewStore, runtimeStore);
        const verification = new VerificationRunner(project.verification, execution, completionGuard.failures);
        const orchestrator = new Orchestrator(new BackendAgentInference(profileId => this.backends.get(profileId)), project.agents, { profileId: managerProfileId, model: managerModel });
        const managerAgent = orchestrator.createAgent({ role: 'manager', initialContext: this.history });
        const watchdogModel = project.watchdog.model; const watchdogProfileId = watchdogModel?.profileId ?? managerProfileId;
        const watchdogAnalyzer = watchdogModel ? new BackendWatchdogAnalyzer(watchdogProfileId, watchdogModel.model, profileId => this.backends.get(profileId)) : new RuleBasedWatchdogAnalyzer();
        const watchdog = new WatchdogService(root, taskState, taskEvidence, watchdogAnalyzer, project.watchdog.intervalTurns);
        const escalation = new EscalationController(root, project.watchdog, taskState, { profileId: managerProfileId, model: managerModel });
        escalation.resume(this.chatId); completionGuard.failures.useEscalations(escalation);
        const routedModel = new RoutedToolLoopModel(escalation.currentModel(), generation, profileId => this.backends.get(profileId));
        const research = new ResearchService(new HttpResearchProvider(project.research), researchStore, project.research, root);
        const documentationModel = project.agents.roleModels['documentation-agent']; const documentationBackend = this.backends.get(documentationModel?.profileId ?? managerProfileId);
        if (!documentationBackend) throw new Error('DocumentationAgent connection was not found.');
        const documentationAgent = new DocumentationAgent(root, taskState, new BackendDocumentationAnalyzer(documentationBackend, documentationModel?.model ?? managerModel), documentationStore);
        const reviewerModel = project.agents.roleModels.reviewer; const reviewerBackend = this.backends.get(reviewerModel?.profileId ?? managerProfileId);
        if (!reviewerBackend) throw new Error('Reviewer connection was not found.');
        const independentReviewer = new IndependentReviewer(root, taskState, taskEvidence, researchStore, documentationStore, new BackendReviewerAnalyzer(reviewerBackend, reviewerModel?.model ?? managerModel), reviewStore, baseline);
        const computer = new ComputerAgent(root, project.computer, async request => {
          const choice = await vscode.window.showWarningMessage(`LGS requests ${request.operation}: ${request.target}`, { modal: true, detail: request.reason + (request.dryRun ? '\nThis request is a dry run.' : '') }, 'Allow once');
          return choice === 'Allow once';
        });
        const integrations = configuredIntegrations(project.integrations);
        const publish = () => this.publishDashboard(taskState, orchestrator, researchStore, reviewStore, managerProfileId, managerModel);
        const audit = { record: (entry: ToolAuditRecord) => {
          this.logger.info('Tool audit ' + JSON.stringify(entry));
          this.activities.unshift({ label: toolLabel(entry.toolId), detail: entry.status === 'success' ? `${entry.result.resultCount ?? 0} result${entry.result.resultCount === 1 ? '' : 's'} · ${entry.durationMs}ms` : `Failed: ${entry.errorCode ?? entry.status}`, status: entry.status === 'success' ? 'completed' : 'warning', at: entry.timestamp });
          publish();
        } };
        const executor = new ToolExecutor(createWorkspaceToolRegistry({
          gitBaseline: baseline, verificationRunner: verification, executionLogs: logs, completionGuard, completionEvidence,
          orchestrator, managerAgentId: managerAgent.id, taskState, watchdog, research, researchStore,
          documentationAgent, documentationStore, independentReviewer, reviewStore, processes, runtimeVerifier,
          runtimeStore, integrations, usage: this.usage, pricing: this.pricing, computer,
          editing,
        }), root, audit);
        publish();
        const outcome = await runToolLoop({
          model: routedModel, executor, messages: this.history,
          identity: { taskId: this.chatId, sessionId: this.chatId, agentId: managerAgent.id, agentRole: 'manager', model: escalation.currentModel().model, taskMode: this.options.mode },
          signal: this.abort.signal, completionGuard, watchdog, escalation,
          onCompletionState: state => { this.completion = state; this.send({ type: 'completionState', state }); publish(); },
        });
        answer = outcome.text;
        if (outcome.status === 'limit') { this.send({ type: 'error', message: answer }); answer = ''; }
        if (answer && outcome.status === 'complete') this.send({ type: 'textDelta', text: answer });
        publish();
      }
    } catch (error) {
      if (!this.abort.signal.aborted) this.send({ type: 'error', message: error instanceof Error ? error.message : 'Generation failed.' });
    } finally {
      await runtimeVerifier?.dispose();
      if (this.activities[0]?.status === 'active') this.activities[0].status = this.abort.signal.aborted ? 'warning' : 'completed';
      this.send({ type: 'streamEnd' }); if (answer) this.history.push(textMessage('assistant', answer)); this.saveChat(); this.abort = undefined;
    }
  }

  private publishDashboard(taskState: FileTaskStateStore, orchestrator: Orchestrator, research: FileResearchStore, reviews: FileReviewStore, profile: string, model: string): void {
    if (!this.chatId) return; const task = taskState.read(this.chatId); if (!task) return;
    const usage = this.usage?.dashboard(this.chatId); const latest = usage?.records.at(-1); const review = reviews.latest(this.chatId);
    const cost = usage?.records.reduce((sum, record) => sum + (record.providerReportedCostUsd ?? record.estimatedCostUsd ?? 0), 0);
    this.send({ type: 'taskDashboard', dashboard: {
      taskId: this.chatId, objective: task.objective, acceptanceCriteria: task.acceptanceCriteria,
      plan: task.currentPlan, completed: task.completedWork, remaining: task.remainingWork,
      files: task.recentModifications, completion: this.completion, advisor: { profile, model },
      agents: orchestrator.listAgents().map(agent => ({ role: agent.role, profile: agent.model.profileId, model: agent.model.model, state: agent.state })),
      activities: this.activities.slice(0, 20),
      usage: { context: latest?.contextUtilized ?? 0, contextMaximum: latest?.contextMaximum, tokens: (usage?.totals.inputTokens ?? 0) + (usage?.totals.outputTokens ?? 0), tokensPerSecond: latest?.tokensPerSecond, cost },
      git: { modified: task.recentModifications.length, commit: task.commitSha },
      review: { findings: review?.findings.length ?? 0, status: review?.status }, researchCount: research.read(this.chatId).length,
    } });
  }

  private restoreDashboard(): void {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath; if (!root || !this.chatId) return;
    const taskState = new FileTaskStateStore(root); const task = taskState.read(this.chatId); if (!task) return;
    const research = new FileResearchStore(root); const taskEvidence = new FileTaskEvidenceStore(root); const documentation = new FileDocumentationAuditStore(root, taskState);
    const reviews = new FileReviewStore(root, documentation, taskEvidence, research);
    const orchestrator = new Orchestrator({ run: async () => '' }, this.settings.workspaceConfiguration().agents, { profileId: this.profileId, model: this.model });
    this.publishDashboard(taskState, orchestrator, research, reviews, this.profileId, this.model);
  }

  private async taskAction(action: TaskAction): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root || !this.chatId) { this.send({ type: 'error', message: 'No active persisted task is available.' }); return; }
    if (action === 'viewDiff') { await vscode.commands.executeCommand('workbench.view.scm'); return; }
    const file = action === 'viewTaskState' ? path.join(root, '.lgs', 'tasks', this.chatId, 'state.json')
      : action === 'viewResearch' ? path.join(root, '.lgs', 'tasks', this.chatId, 'research.json')
      : newestFile(path.join(root, '.lgs', 'logs'));
    if (!file || !fs.existsSync(file)) { this.send({ type: 'error', message: action === 'viewLogs' ? 'No execution log has been recorded for this task.' : action === 'viewResearch' ? 'No research evidence has been recorded for this task.' : 'The task state file is unavailable.' }); return; }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file)); await vscode.window.showTextDocument(document, { preview: true });
  }

  private saveChat(): void {
    if (!this.history.length) return;
    const chat: SavedChat = { id: this.chatId || Date.now().toString(36), title: this.history.find(message => message.role === 'user')?.content.map(part => part.type === 'text' ? part.text : '').join('').slice(0, 60) || 'New task', updatedAt: Date.now(), messages: this.history };
    this.chatId = chat.id; this.chats = [chat, ...this.chats.filter(candidate => candidate.id !== chat.id)].slice(0, 100);
    void this.context.globalState.update('lgs.chats', this.chats); this.sendChats();
  }

  refreshAppearance(): void {
    const theme = this.settings.effective().find(setting => setting.id === 'appearance.theme')?.value;
    this.send({ type: 'appearance', theme: theme === 'lgs-light' || theme === 'lgs-dark' ? theme : 'vscode' });
  }
  refreshSettings(): void { this.refreshAppearance(); this.selectConfiguredDefaults(); this.sendProfiles(); void this.listModels(); }
  async refreshConnections(): Promise<void> { this.profiles = loadProfiles(this.context); this.rebuilding = this.rebuild(); await this.rebuilding; this.selectConfiguredDefaults(); this.sendProfiles(); await this.listModels(); }
}

function configuredIntegrations(configuration: import('./integrations/types.js').IntegrationConfiguration | undefined): IntegrationHub {
  const hub = new IntegrationHub(); if (!configuration) return hub;
  const names = [...new Set([...configuration.required, ...configuration.recommended, ...configuration.optional, ...Object.keys(configuration.mcp)])];
  for (const id of names) if (/^[a-z][a-z0-9._-]{0,80}$/.test(id)) hub.register({
    id, name: id, description: 'Declared in workspace configuration; no live connector is installed.', origin: configuration.mcp[id] ? 'mcp' : 'plugin', source: '.lgs/config.yaml', status: 'disconnected', capabilities: [], requestedPermissions: [], allowedAgents: {}, processOwnedByLgs: false,
  });
  return hub;
}

function providerPolicy(value: ProviderDataPolicy | undefined): ProviderDataPolicy | undefined { return value === 'cloud' ? 'repository_allowed' : value; }
function toolLabel(id: string): string { return id.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '); }
function newestFile(directory: string): string | undefined {
  try { return fs.readdirSync(directory).map(name => path.join(directory, name)).filter(file => fs.statSync(file).isFile()).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]; } catch { return; }
}

function getHtml(webview: vscode.Webview, uri: vscode.Uri): string {
  const script = webview.asWebviewUri(vscode.Uri.joinPath(uri, 'dist', 'webview.js'));
  const style = webview.asWebviewUri(vscode.Uri.joinPath(uri, 'dist', 'webview.css'));
  const nonce = Date.now().toString(36);
  return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${style}"></head><body><div id="app"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
}

async function rebuildIndex(logger: Logger, notify: boolean): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]; if (!folder) { if (notify) void vscode.window.showWarningMessage('LGS: Open a workspace to index its repository.'); return; }
  const root = folder.uri.fsPath; const file = path.join(root, '.lgs', 'index.json'); let previous: RepositoryIndex | undefined;
  try { previous = JSON.parse(fs.readFileSync(file, 'utf8')) as RepositoryIndex; } catch { /* First run. */ }
  try { const index = writeRepositoryIndex(root, previous); logger.info(`Repository index updated: ${index.files.length} files`); if (notify) void vscode.window.showInformationMessage('LGS: Repository index updated.'); }
  catch (error) { logger.error(error instanceof Error ? error.message : 'Repository index failed.'); if (notify) void vscode.window.showErrorMessage('LGS: Could not rebuild repository index.'); }
}

async function openCodebaseMap(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]; if (!folder) { void vscode.window.showWarningMessage('LGS: Open a workspace to view the Codebase Map.'); return; }
  const root = folder.uri.fsPath;
  try { const index = JSON.parse(fs.readFileSync(path.join(root, '.lgs', 'index.json'), 'utf8')) as RepositoryIndex; const freshness = getFreshness(root, index); if (freshness.index === 'stale') void vscode.window.showWarningMessage('LGS: Codebase Map is stale. Run LGS: Rebuild Repository Index.'); }
  catch { void vscode.window.showWarningMessage('LGS: No repository index found. Run LGS: Rebuild Repository Index.'); }
  try { const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, '.lgs', 'CODEBASE_MAP.md')); await vscode.window.showTextDocument(document); }
  catch { void vscode.window.showErrorMessage('LGS: CODEBASE_MAP.md is unavailable. Rebuild the repository index.'); }
}
