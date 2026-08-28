import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getFreshness, writeRepositoryIndex, type RepositoryIndex } from './intelligence/indexer.js';
import type { ModelBackend } from './model/backend.js';
import { ProviderConnectionService } from './model/connections.js';
import { normalizeProviderError, ProviderDiagnosticsStore } from './model/diagnostics.js';
import { createBackends, type BackendObservation } from './model/registry.js';
import { loadProfiles, profileBilling, type BackendProfile, type ProviderDataPolicy } from './model/profiles.js';
import { textFromMessage, textMessage, type LgsMessage } from './model/types.js';
import type { ModelInfo } from './model/types.js';
import { SettingsManager } from './settings/configuration.js';
import { SettingsPanel } from './settings/panel.js';
import { LgsLifecycleService } from './settings/lifecycle.js';
import { Logger } from './shared/logger.js';
import { parseClientMessage, type ChatOptions, type HostMessage, type TaskActivity, type TaskAction, type TaskDashboard } from './shared/messages.js';
import {
  BackendAgentInference, BackendDocumentationAnalyzer, BackendReviewerAnalyzer, BackendWatchdogAnalyzer,
  CommandExecutionService, CommandPermissionResolver, CompletionGuard, ComputerAgent, createWorkspaceToolRegistry,
  displayCommand, DocumentationAgent, EscalationController, FileCompletionEvidenceStore, FileDocumentationAuditStore,
  FileEditService,
  ContextLifecycleManager, FileResearchCycleStore, FileResearchRequirementStore, FileResearchStore, FileReviewStore, FileRoutingDecisionStore, FileRuntimeStore, FileTaskEvidenceStore,
  FileTaskStateStore, GitBaselineStore, HttpResearchProvider, IndependentReviewer, IntegrationHub,
  ManagedProcessManager, ModelRouter, Orchestrator, PlanningArtifactStore, RawExecutionLogStore, ResearchCycleEngine, ResearchExecutionGuard, ResearchService, RoutedToolLoopModel,
  RuleBasedWatchdogAnalyzer, runToolLoop, RuntimeVerifier, ToolExecutor, VerificationRunner, WatchdogService,
  TaskArtifactPipeline, type GitBaseline, type PermissionConfiguration, type ToolAuditRecord, type ToolExecutionGuard,
} from './tools/index.js';
import { FilePricingStore, FileUsageStore, setActiveUsageTracker, UsageTracker } from './usage/index.js';
import { UsageDashboardPanel } from './usage/panel.js';
import { ActivityLogPanel } from './interaction/panel.js';
import { contextUsage, FileActivityStore, MemoryActivityStore, modeAllows, RequestExecutionService, type ActivityEventType, type ExecutionMode, type RequestExecution } from './interaction/index.js';

type AttachmentSummary = { name: string; mediaType: string; bytes: number };
type SavedChat = { id: string; title: string; updatedAt: number; messages: LgsMessage[]; attachments?: Record<number, AttachmentSummary[]>; requestIds?: string[] };

export function activate(context: vscode.ExtensionContext): void {
  const logger = new Logger('LGS');
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const settings = new SettingsManager(context, root);
  const pricing = root ? new FilePricingStore(root) : undefined;
  const usage = root && pricing ? new UsageTracker(new FileUsageStore(root), pricing, settings.workspaceConfiguration().usage) : undefined;
  setActiveUsageTracker(usage, id => { const profile = loadProfiles(context).find(candidate => candidate.id === id); return profile ? profileBilling(profile) : 'unknown'; });
  const diagnostics = new ProviderDiagnosticsStore(context.globalState, () => usage?.records() || []);
  const connections = new ProviderConnectionService(context, diagnostics, pricing);
  const provider = new LgsViewProvider(context, logger, settings, connections, usage, pricing);
  let refreshSettingsPanel = () => {};
  const lifecycle = new LgsLifecycleService(connections, diagnostics, provider, () => refreshSettingsPanel(), async () => { await vscode.commands.executeCommand('workbench.action.reloadWindow'); });
  const settingsPanel = new SettingsPanel(context, settings, connections, () => provider.refreshConnections(), () => provider.refreshSettings(), action => lifecycle.run(action));
  refreshSettingsPanel = () => settingsPanel.refresh();
  provider.attachSettingsPanel(settingsPanel);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('lgs.sidebar', provider),
    vscode.commands.registerCommand('lgs.open', () => vscode.commands.executeCommand('workbench.view.extension.lgs')),
    vscode.commands.registerCommand('lgs.settings', () => settingsPanel.show()),
    vscode.commands.registerCommand('lgs.rebuildIndex', () => rebuildIndex(logger, true)),
    vscode.commands.registerCommand('lgs.openCodebaseMap', () => openCodebaseMap()),
    vscode.commands.registerCommand('lgs.openUsage', () => usage ? new UsageDashboardPanel(usage).show() : vscode.window.showWarningMessage('LGS: Open a workspace to view usage.')),
    { dispose: () => { void connections.ollama.dispose(); } },
  );
  logger.info('Extension activated');
  void connections.initializeManagedOllama().finally(() => { settingsPanel.refresh(); void provider.refreshConnections(); });
  void rebuildIndex(logger, false);
}

export function deactivate(): void {}

class LgsViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private profiles: BackendProfile[];
  private backends = new Map<string, ModelBackend>();
  private profileId = '';
  private model = '';
  private models: ModelInfo[] = [];
  private history: LgsMessage[] = [];
  private abort?: AbortController;
  private options: ChatOptions = { mode: 'normal', thinking: 'auto', autoResearch: 'when-uncertain', capabilities: { web: true, code: true, terminal: true, browser: true, computer: false, integrations: true }, approval: 'on-request' };
  private chats: SavedChat[];
  private chatId = '';
  private gitBaselines: GitBaselineStore;
  private activities: TaskActivity[] = [];
  private completion?: TaskDashboard['completion'];
  private settingsPanel?: SettingsPanel;
  private rebuilding?: Promise<void>;
  private readonly executions: RequestExecutionService;
  private readonly activityPanel: ActivityLogPanel;
  private currentRequestId = '';
  private attachmentHistory: Record<number, AttachmentSummary[]> = {};
  private requestIds: string[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logger: Logger,
    private readonly settings: SettingsManager,
    private readonly connections: ProviderConnectionService,
    private readonly usage?: UsageTracker,
    private readonly pricing?: FilePricingStore,
  ) {
    this.profiles = loadProfiles(context);
    this.chats = context.globalState.get<SavedChat[]>('lgs.chats') || [];
    this.gitBaselines = new GitBaselineStore(context.globalState.get<Record<string, GitBaseline>>('lgs.gitBaselines') || {});
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const activityStore = root ? new FileActivityStore(root) : new MemoryActivityStore();
    this.executions = new RequestExecutionService(activityStore, (request) => this.publishExecution(request));
    this.activityPanel = new ActivityLogPanel(context, requestId => { const request = this.executions.current(requestId); return request ? { request, events: this.executions.events(requestId) } : undefined; }, root);
    const research = settings.workspaceConfiguration().research; this.options.autoResearch = research.autoResearch; this.options.capabilities.web = research.webEnabled;
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
    this.backends = createBackends(this.profiles, profile => profile.secretName ? secrets.get(profile.secretName) : undefined, profile => secretHeaders.get(profile.id) || {}, (profile, event) => { void this.observeProvider(profile, event); });
  }

  private async observeProvider(profile: BackendProfile, event: BackendObservation): Promise<void> {
    const now = new Date().toISOString(); const previous = this.connections.diagnostics.status(profile);
    if (event.type === 'connecting') await this.connections.diagnostics.updateStatus(profile.id, { ...previous, state: 'connecting', checkedAt: now, message: `Connecting to ${profile.name} for a model request.` });
    else if (event.type === 'connected') await this.connections.diagnostics.updateStatus(profile.id, { ...previous, state: 'online', checkedAt: now, message: 'Provider accepted the model request.' });
    else if (event.type === 'done') await this.connections.diagnostics.updateStatus(profile.id, { ...previous, state: 'online', checkedAt: now, lastSuccessfulAt: now, message: `Request completed${event.durationMs === undefined ? '.' : ` in ${event.durationMs} ms.`}` });
    else {
      const diagnostic = normalizeProviderError(event.error, profile);
      await this.connections.diagnostics.updateStatus(profile.id, { ...previous, state: diagnostic.state, checkedAt: now, message: diagnostic.summary });
      await this.connections.diagnostics.record({ connectionId: profile.id, type: 'error', operation: 'model request', result: 'failed', message: `${diagnostic.summary}${diagnostic.guidance ? ` ${diagnostic.guidance}` : ''}`, model: event.model, durationMs: event.durationMs });
    }
    this.settingsPanel?.refresh();
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
    if (message.type === 'openActivity') { if (this.currentRequestId) this.activityPanel.show(this.currentRequestId); return; }
    if (message.type === 'openResource') { await this.openResource(message.path, message.line); return; }
    if (message.type === 'providerAction') { await this.providerAction(message.action); return; }
    if (message.type === 'taskAction') { await this.taskAction(message.action); return; }
    if (message.type === 'newChat') {
      this.history = []; this.chatId = ''; this.activities = []; this.completion = undefined; this.attachmentHistory = {}; this.requestIds = []; this.currentRequestId = '';
      this.send({ type: 'chatLoaded', messages: [] }); return;
    }
    if (message.type === 'loadChat') {
      const chat = this.chats.find(candidate => candidate.id === message.chatId);
      if (chat) {
        this.chatId = chat.id; this.history = chat.messages; this.activities = []; this.completion = undefined; this.attachmentHistory = chat.attachments || {}; this.requestIds = chat.requestIds || []; this.currentRequestId = this.requestIds.at(-1) || '';
        this.send({ type: 'chatLoaded', messages: chat.messages.flatMap((item, index) => item.role === 'system' ? [] : [{ role: item.role as 'user' | 'assistant', text: item.content.map(part => part.type === 'text' ? part.text : '[image]').join(''), ...(this.attachmentHistory[index]?.length ? { attachments: this.attachmentHistory[index] } : {}) }]) });
        const execution = this.currentRequestId && this.executions.current(this.currentRequestId); if (execution) this.publishExecution(execution);
        this.restoreDashboard();
      }
      return;
    }
    if (message.type === 'selectProfile') {
      if (this.backends.has(message.profileId)) { this.profileId = message.profileId; this.model = ''; this.sendProfiles(); await this.listModels(); }
      return;
    }
    if (message.type === 'selectModel') { this.model = message.model; this.publishContextUsage(); return; }
    if (message.type === 'setOptions') { this.options = message.options; this.send({ type: 'options', options: this.options }); return; }
    if (message.type === 'listModels') { await this.listModels(); return; }
    if (message.type === 'userMessage') {
      if (!this.model) { await this.listModels(); if (!this.model) { this.send({ type: 'error', message: 'No model is available for this connection. Open Settings to test the endpoint and discover models.' }); return; } }
      if (!this.chatId) this.chatId = Date.now().toString(36);
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (root && message.attachments?.length) {
        const pipeline = new TaskArtifactPipeline(root); const hasVision = this.backend()?.capabilities.multimodal ?? false;
        for (const attachment of message.attachments) {
          const data = Buffer.from(attachment.dataBase64, 'base64'); if (data.length !== attachment.bytes) { this.send({ type: 'error', message: `Attachment ${attachment.name} failed integrity validation.` }); return; }
          pipeline.ingest(this.chatId, { name: attachment.name, mediaType: attachment.mediaType, data, source: attachment.source, primaryModelHasVision: hasVision });
        }
      }
      if (message.attachments?.length) this.attachmentHistory[this.history.length] = message.attachments.map(({ name, mediaType, bytes }) => ({ name, mediaType, bytes }));
      this.history.push(textMessage('user', message.text)); await this.generate();
    }
  }

  private async listModels(): Promise<void> {
    const backend = this.backend();
    if (!backend) { this.send({ type: 'models', models: [], selected: '' }); this.send({ type: 'state', state: 'No enabled connection' }); return; }
    this.send({ type: 'state', state: 'Connecting…' });
    try {
      this.settingsPanel?.refresh();
      const result = await this.connections.test(this.profileId);
      const models = result.models; this.models = models;
      if (!result.ok) throw new Error(`${result.title}\n${result.endpoint}\n\n${result.summary}${result.guidance ? `\n\n${result.guidance}` : ''}`);
      const preferred = String(this.settings.effective().find(setting => setting.id === 'models.defaultModel')?.value || '');
      this.model = models.some(model => model.id === this.model) ? this.model : models.some(model => model.id === preferred) ? preferred : models[0]?.id || '';
      this.send({ type: 'models', models: models.map(item => ({ ...item, reasoning: item.capabilities?.reasoning ?? backend.capabilities.reasoning, vision: item.capabilities?.multimodal ?? backend.capabilities.multimodal })), selected: this.model });
      this.publishContextUsage(); this.publishProviderNotice('running');
      this.send({ type: 'state', state: models.length ? 'Ready' : 'Connected · no models' });
    } catch (error) {
      this.models = []; this.send({ type: 'models', models: [], selected: '' });
      const profile = this.profiles.find(item => item.id === this.profileId); const message = error instanceof Error ? error.message : 'Unable to connect or discover models.';
      if (profile?.kind === 'ollama') this.publishProviderNotice(this.connections.ollamaInfo(profile.id).state, message); else this.send({ type: 'error', message });
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
    this.currentRequestId = `${this.chatId}-${Date.now().toString(36)}`; this.requestIds.push(this.currentRequestId);
    const objective = textFromMessage([...this.history].reverse().find(message => message.role === 'user')!);
    this.executions.start(this.currentRequestId, objective, this.options.mode);
    this.executions.finishPhase(this.currentRequestId, 'understand', 'completed', 'Request and execution policy established.');
    const nextPhase = this.executions.current(this.currentRequestId)?.phases.find(phase => phase.status === 'pending'); if (nextPhase) this.executions.startPhase(this.currentRequestId, nextPhase.id);
    this.abort = new AbortController(); this.send({ type: 'streamStart', backend: backend.displayName, model: managerModel });
    this.activities.unshift({ label: 'Advisor started', detail: route.reason, status: 'active', at: new Date().toISOString() });
    let answer = ''; let runtimeVerifier: RuntimeVerifier | undefined; let failed: string | undefined; let outcomeStatus: 'complete' | 'cancelled' | 'limit' = 'complete';
    const reasoning = this.options.thinking !== 'auto' && backend.capabilities.reasoning ? { enabled: true, effort: this.options.thinking } : undefined;
    const generation = {
      temperature: 0.5,
      maxTokens: 1024,
      ...(reasoning ? { reasoning } : {}),
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
        this.advanceExecution('plan');
        const baseline = await this.gitBaselines.ensure(this.chatId, root, this.abort.signal);
        await this.context.globalState.update('lgs.gitBaselines', this.gitBaselines.serialize());
        const commandFallback = this.options.approval === 'always' ? 'always_allow' : this.options.approval === 'never' ? 'deny' : 'ask';
        const permissionResolver = new CommandPermissionResolver(this.context.globalState.get<PermissionConfiguration>('lgs.commandPermissions') || {}, project.permissions, commandFallback);
        const logs = new RawExecutionLogStore(root); const taskEvidence = new FileTaskEvidenceStore(root); const taskState = new FileTaskStateStore(root);
        taskState.ensure(this.chatId, textFromMessage(this.history.find(message => message.role === 'user')!));
        const documentationStore = new FileDocumentationAuditStore(root, taskState); const researchStore = new FileResearchStore(root);
        const researchRequirements = new FileResearchRequirementStore(root); const researchCycleStore = new FileResearchCycleStore(root);
        const contextLifecycle = new ContextLifecycleManager(root, project.context);
        const researchCycles = new ResearchCycleEngine(researchCycleStore, project.research.budgets, taskId => { const usage = this.usage?.dashboard(taskId); return { tokens: (usage?.totals.inputTokens ?? 0) + (usage?.totals.outputTokens ?? 0), costUsd: usage?.records.reduce((sum, item) => sum + (item.providerReportedCostUsd ?? item.estimatedCostUsd ?? 0), 0) ?? 0 }; });
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
        runtimeVerifier = new RuntimeVerifier(project.runtime, processes, runtimeStore, root, async action => {
          const choice = await vscode.window.showWarningMessage(`LGS BrowserAgent requests a consequential action: ${action.description}`, { modal: true, detail: action.url ? `Website: ${action.url}` : undefined }, 'Allow once'); return choice === 'Allow once';
        });
        const completionGuard = new CompletionGuard(root, project.completion, completionEvidence, taskEvidence, documentationStore, reviewStore, runtimeStore);
        const verification = new VerificationRunner(project.verification, execution, completionGuard.failures);
        const orchestrator = new Orchestrator(new BackendAgentInference(profileId => this.backends.get(profileId)), project.agents, { profileId: managerProfileId, model: managerModel });
        const managerAgent = orchestrator.createAgent({ role: 'manager', initialContext: this.history });
        const watchdogModel = project.watchdog.model; const watchdogProfileId = watchdogModel?.profileId ?? managerProfileId;
        const watchdogAnalyzer = watchdogModel ? new BackendWatchdogAnalyzer(watchdogProfileId, watchdogModel.model, profileId => this.backends.get(profileId)) : new RuleBasedWatchdogAnalyzer();
        const watchdog = new WatchdogService(root, taskState, taskEvidence, watchdogAnalyzer, project.watchdog.intervalTurns, researchRequirements, this.options.autoResearch);
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
          const traceType = activityType(entry); const resource = activityResource(entry); const status = entry.status === 'success' ? 'success' : entry.status === 'cancelled' ? 'blocked' : 'failed';
          this.executions.event(this.currentRequestId, traceType, toolLabel(entry.toolId), { phaseId: this.executions.current(this.currentRequestId)?.phases.find(phase => phase.status === 'active')?.id, status, resource, metadata: { durationMs: entry.durationMs, resultCount: entry.result.resultCount ?? 0, truncated: entry.result.truncated } }, entry.timestamp);
          if (entry.permission.access === 'execute' && this.options.mode !== 'plan' && this.options.mode !== 'web') this.advanceExecution('implement');
          publish();
        } };
        const registry = createWorkspaceToolRegistry({
          gitBaseline: baseline, verificationRunner: verification, executionLogs: logs, completionGuard, completionEvidence,
          orchestrator, managerAgentId: managerAgent.id, taskState, watchdog, research, researchStore,
          researchCycles, researchRequirements,
          documentationAgent, documentationStore, independentReviewer, reviewStore, processes, runtimeVerifier,
          runtimeStore, integrations, usage: this.usage, pricing: this.pricing, computer,
          editing, contextLifecycle,
        });
        const capabilityGuard: ToolExecutionGuard = { check: definition => capabilityBlock(definition.id, definition.permission, this.options) };
        const executor = new ToolExecutor(registry, root, audit, undefined, [new ResearchExecutionGuard(researchRequirements, project.research.webEnabled && this.options.capabilities.web), capabilityGuard]);
        publish();
        const outcome = await runToolLoop({
          model: routedModel, executor, messages: this.history,
          identity: { taskId: this.chatId, sessionId: this.chatId, agentId: managerAgent.id, agentRole: 'manager', model: escalation.currentModel().model, taskMode: taskMode(this.options.mode) },
          signal: this.abort.signal, completionGuard, watchdog, escalation,
          onCompletionState: state => { this.completion = state; this.send({ type: 'completionState', state }); publish(); },
        });
        outcomeStatus = outcome.status;
        answer = outcome.text;
        if (outcome.status === 'limit') { this.send({ type: 'error', message: answer }); answer = ''; }
        if (answer && outcome.status === 'complete') this.send({ type: 'textDelta', text: answer });
        publish();
      }
    } catch (error) {
      failed = error instanceof Error ? error.message : 'Generation failed.';
      if (!this.abort.signal.aborted) this.send({ type: 'error', message: error instanceof Error ? error.message : 'Generation failed.' });
    } finally {
      await runtimeVerifier?.dispose();
      if (this.activities[0]?.status === 'active') this.activities[0].status = this.abort.signal.aborted ? 'warning' : 'completed';
      const stopped = this.abort.signal.aborted || outcomeStatus === 'cancelled';
      if (!stopped && !failed && outcomeStatus === 'complete') this.advanceExecution('verify');
      this.executions.finish(this.currentRequestId, stopped ? 'stopped' : failed || outcomeStatus === 'limit' ? 'failed' : 'completed', failed || (outcomeStatus === 'limit' ? 'Execution limit reached.' : undefined));
      this.send({ type: 'streamEnd' }); if (answer) this.history.push(textMessage('assistant', answer)); this.saveChat(); this.abort = undefined; this.publishContextUsage();
    }
  }

  private publishDashboard(taskState: FileTaskStateStore, orchestrator: Orchestrator, research: FileResearchStore, reviews: FileReviewStore, profile: string, model: string): void {
    if (!this.chatId) return; const task = taskState.read(this.chatId); if (!task) return;
    const usage = this.usage?.dashboard(this.chatId); const latest = usage?.records.at(-1); const review = reviews.latest(this.chatId);
    const cost = usage?.records.reduce((sum, record) => sum + (record.providerReportedCostUsd ?? record.estimatedCostUsd ?? 0), 0);
    const lifecycle = contextState(taskState.workspaceRoot, this.chatId, latest?.contextUtilized, latest?.contextMaximum, this.settings.workspaceConfiguration().context);
    this.send({ type: 'taskDashboard', dashboard: {
      taskId: this.chatId, objective: task.objective, acceptanceCriteria: task.acceptanceCriteria,
      plan: task.currentPlan, completed: task.completedWork, remaining: task.remainingWork,
      files: task.recentModifications, completion: this.completion, advisor: { profile, model },
      agents: orchestrator.listAgents().map(agent => ({ role: agent.role, profile: agent.model.profileId, model: agent.model.model, state: agent.state })),
      activities: this.activities.slice(0, 20),
      usage: { context: latest?.contextUtilized ?? 0, contextMaximum: latest?.contextMaximum, tokens: (usage?.totals.inputTokens ?? 0) + (usage?.totals.outputTokens ?? 0), tokensPerSecond: latest?.tokensPerSecond, cost },
      git: { modified: task.recentModifications.length, commit: task.commitSha },
      review: { findings: review?.findings.length ?? 0, status: review?.status }, researchCount: research.read(this.chatId).length,
      planArtifact: new PlanningArtifactStore(taskState.workspaceRoot, taskState).read(this.chatId),
      research: new FileResearchCycleStore(taskState.workspaceRoot).read(this.chatId),
      contextLifecycle: lifecycle,
      usageDetails: { searches: new Set(research.read(this.chatId).map(item => item.queryKey)).size, rotations: lifecycle?.rotations ?? 0, compactionSaved: lifecycle?.compactedTokensSaved ?? 0, byAgent: (usage?.aggregates.agent ?? []).map(item => ({ agent: item.key, tokens: item.inputTokens + item.outputTokens, cost: item.providerReportedCostUsd + item.estimatedCostUsd })) },
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
    const plans = new PlanningArtifactStore(root, new FileTaskStateStore(root));
    if (action === 'approvePlan') { plans.approve(this.chatId); this.restoreDashboard(); return; }
    if (action === 'editPlan') {
      const current = plans.read(this.chatId); if (!current) { this.send({ type: 'error', message: 'PLAN.md is unavailable.' }); return; }
      const editable = { objective: current.objective, acceptanceCriteria: current.acceptanceCriteria, currentUnderstanding: current.currentUnderstanding, approach: current.approach, expectedAreas: current.expectedAreas, implementationStages: current.implementationStages, verificationPlan: current.verificationPlan, risks: current.risks, openQuestions: current.openQuestions };
      const raw = await vscode.window.showInputBox({ title: 'Edit LGS plan', prompt: 'Edit the structured plan JSON. Saving creates an append-only revision.', value: JSON.stringify(editable), ignoreFocusOut: true }); if (raw === undefined) return;
      try { plans.regenerate(this.chatId, JSON.parse(raw) as typeof editable, 'User edited the structured plan through the Plan view.', ['Direct user edit']); this.restoreDashboard(); }
      catch (error) { this.send({ type: 'error', message: error instanceof Error ? error.message : 'The edited plan is invalid.' }); }
      return;
    }
    if (action === 'beginImplementation') { const plan = plans.read(this.chatId); if (plan?.handoff === 'wait-for-approval' && plan.status !== 'approved') { this.send({ type: 'error', message: 'Approve the plan before beginning implementation.' }); return; } this.options = { ...this.options, mode: 'normal' }; this.send({ type: 'options', options: this.options }); return; }
    if (action === 'regeneratePlan') { this.options = { ...this.options, mode: 'plan' }; this.send({ type: 'options', options: this.options }); this.send({ type: 'state', state: 'Plan mode ready · submit revision evidence' }); return; }
    const file = action === 'viewTaskState' ? path.join(root, '.lgs', 'tasks', this.chatId, 'state.json')
      : action === 'viewPlan' ? path.join(root, '.lgs', 'tasks', this.chatId, 'PLAN.md')
      : action === 'viewResearch' ? (fs.existsSync(path.join(root, '.lgs', 'tasks', this.chatId, 'RESEARCH.md')) ? path.join(root, '.lgs', 'tasks', this.chatId, 'RESEARCH.md') : path.join(root, '.lgs', 'tasks', this.chatId, 'research.json'))
      : newestFile(path.join(root, '.lgs', 'logs'));
    if (!file || !fs.existsSync(file)) { this.send({ type: 'error', message: action === 'viewLogs' ? 'No execution log has been recorded for this task.' : action === 'viewResearch' ? 'No research evidence has been recorded for this task.' : 'The task state file is unavailable.' }); return; }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file)); await vscode.window.showTextDocument(document, { preview: true });
  }

  private publishExecution(request: RequestExecution): void {
    const events = this.executions.events(request.id); this.send({ type: 'requestExecution', request, events }); this.activityPanel?.update(request, events);
  }
  private advanceExecution(phaseId: string): void {
    if (!this.currentRequestId) return; const request = this.executions.current(this.currentRequestId); const target = request?.phases.find(phase => phase.id === phaseId); if (!target || target.status === 'active' || ['completed', 'failed', 'blocked', 'skipped'].includes(target.status)) return;
    this.executions.startPhase(this.currentRequestId, phaseId);
  }
  private publishContextUsage(): void {
    const model = this.models.find(item => item.id === this.model); const record = this.chatId ? this.usage?.dashboard(this.chatId)?.records.at(-1) : undefined;
    this.send({ type: 'contextUsage', usage: contextUsage(record?.contextUtilized, model?.contextWindow || record?.contextMaximum) });
  }
  private publishProviderNotice(state?: 'offline' | 'starting' | 'running' | 'error', message?: string): void {
    const profile = this.profiles.find(item => item.id === this.profileId); if (profile?.kind !== 'ollama') return; const runtime = this.connections.ollamaInfo(profile.id); const current = state || runtime.state;
    this.send({ type: 'providerNotice', provider: profile.name, state: current, message: message || runtime.message, ownership: runtime.ownership, canStart: current !== 'running' && profile.ollamaManagement?.mode === 'lgs-managed', canRestart: runtime.ownership === 'lgs-managed' && current !== 'starting' });
  }
  private async providerAction(action: 'start' | 'restart' | 'refresh' | 'settings' | 'logs'): Promise<void> {
    const profile = this.profiles.find(item => item.id === this.profileId); if (action === 'settings') { this.settingsPanel?.show(); return; }
    if (action === 'logs') { this.settingsPanel?.show(); return; }
    if (!profile || profile.kind !== 'ollama') return;
    if (action === 'start') { this.publishProviderNotice('starting'); await this.connections.startOllama(profile.id); }
    else if (action === 'restart') { this.publishProviderNotice('starting'); await this.connections.restartOllama(profile.id); }
    await this.listModels(); this.settingsPanel?.refresh();
  }
  private async openResource(resource: string, line?: number): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath; if (!root) return; const file = path.resolve(root, resource); const relative = path.relative(root, file); if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(file)) return;
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file)); const editor = await vscode.window.showTextDocument(document, { preview: true }); if (line) { const position = new vscode.Position(line - 1, 0); editor.selection = new vscode.Selection(position, position); editor.revealRange(new vscode.Range(position, position)); }
  }

  private saveChat(): void {
    if (!this.history.length) return;
    const chat: SavedChat = { id: this.chatId || Date.now().toString(36), title: this.history.find(message => message.role === 'user')?.content.map(part => part.type === 'text' ? part.text : '').join('').slice(0, 60) || 'New task', updatedAt: Date.now(), messages: this.history, attachments: this.attachmentHistory, requestIds: this.requestIds };
    this.chatId = chat.id; this.chats = [chat, ...this.chats.filter(candidate => candidate.id !== chat.id)].slice(0, 100);
    void this.context.globalState.update('lgs.chats', this.chats); this.sendChats();
  }

  refreshAppearance(): void {
    const theme = this.settings.effective().find(setting => setting.id === 'appearance.theme')?.value;
    this.send({ type: 'appearance', theme: theme === 'lgs-light' || theme === 'lgs-dark' ? theme : 'vscode' });
  }
  refreshSettings(): void { this.refreshAppearance(); this.selectConfiguredDefaults(); this.sendProfiles(); void this.listModels(); }
  async refreshConnections(): Promise<void> { this.profiles = loadProfiles(this.context); this.rebuilding = this.rebuild(); await this.rebuilding; this.selectConfiguredDefaults(); this.sendProfiles(); await this.listModels(); }
  async restartServices(): Promise<string> {
    const hadActiveRequest = Boolean(this.abort); this.abort?.abort(); this.settings.reloadWorkspace();
    this.profiles = loadProfiles(this.context); this.rebuilding = this.rebuild(); await this.rebuilding;
    this.selectConfiguredDefaults(); this.sendProfiles(); this.refreshAppearance(); await this.listModels();
    return hadActiveRequest ? 'LGS services restarted. The active request was cancelled safely.' : 'LGS services restarted and provider adapters rebuilt.';
  }
  async restartOwnedLocalRuntimes(): Promise<string> {
    const owned = this.profiles.filter(profile => profile.kind === 'ollama' && this.connections.ollamaInfo(profile.id).ownership === 'lgs-managed');
    for (const profile of owned) await this.connections.restartOllama(profile.id);
    return owned.length ? `Restarted ${owned.length} LGS-managed Ollama runtime${owned.length === 1 ? '' : 's'}. External processes were left untouched.` : 'No LGS-managed Ollama runtime is active. External processes were left untouched.';
  }
  reloadViews(): void { this.sendProfiles(); this.send({ type: 'options', options: this.options }); this.refreshAppearance(); this.sendChats(); void this.listModels(); }
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
function capabilityBlock(id: string, permission: import('./tools/types.js').ToolPermission, options: ChatOptions): string | undefined {
  if (permission.access === 'execute' && !modeAllows(options.mode, 'edit') && !['run_verification'].includes(id)) return `${options.mode === 'plan' ? 'Plan' : 'Web'} Mode is read-only.`;
  if (permission.network && !modeAllows(options.mode, 'web') && options.mode !== 'normal') return `${options.mode === 'plan' ? 'Plan' : 'Normal'} Mode does not enable external web access.`;
  if (permission.scope === 'computer' && !options.capabilities.computer) return 'The Computer capability is disabled for this task.';
  if (id.startsWith('browser_') && !options.capabilities.browser) return 'The Browser capability is disabled for this task.';
  if ((id.includes('integration') || id.includes('mcp')) && !options.capabilities.integrations) return 'The Integrations capability is disabled for this task.';
  if (permission.network && !options.capabilities.web && ['web_search', 'web_fetch', 'documentation_search', 'repository_search'].includes(id)) return 'The Web capability is disabled for this task. Auto Research does not enable Web implicitly.';
  if (['run_verification', 'start_runtime', 'stop_runtime', 'run_runtime_verification'].includes(id) && !options.capabilities.terminal) return 'The Terminal capability is disabled for this task.';
  if ((id.includes('file') || id.includes('patch') || id.includes('edit')) && permission.access === 'execute' && !options.capabilities.code) return 'The Code capability is disabled for this task.';
}
function taskMode(mode: ExecutionMode): import('./planning/types.js').TaskMode { return mode === 'plan' ? 'plan' : mode === 'web' || mode === 'research' ? 'research' : 'implement'; }
function activityType(entry: ToolAuditRecord): ActivityEventType {
  if (entry.status === 'error') return 'error'; if (entry.toolId.includes('test') || entry.toolId.includes('verification')) return 'test'; if (entry.toolId.startsWith('browser_') || entry.result.source === 'research') return 'browser';
  if (entry.toolId.includes('search')) return 'search'; if (entry.toolId.includes('file') || entry.toolId.includes('patch') || entry.toolId.includes('edit')) return 'file'; if (entry.result.source === 'execution' || entry.permission.category === 'process') return 'command'; return 'tool';
}
function activityResource(entry: ToolAuditRecord): import('./interaction/types.js').ActivityEvent['resource'] | undefined {
  const file = [entry.arguments.path, entry.arguments.file, entry.arguments.target].find(value => typeof value === 'string') as string | undefined;
  if (file && (activityType(entry) === 'file' || !/^https?:/i.test(file))) return { kind: 'file', value: file };
  const url = Object.values(entry.arguments).find(value => typeof value === 'string' && /^https?:\/\//i.test(value)) as string | undefined; if (url) return { kind: 'url', value: url };
  return;
}
function contextState(root: string, taskId: string, used: number | undefined, maximum: number | undefined, configuration: import('./context/types.js').ContextLifecycleConfiguration) {
  const lifecycle = new ContextLifecycleManager(root, configuration); return maximum ? lifecycle.observe(taskId, taskId, used ?? 0, maximum) : lifecycle.read(taskId);
}
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
