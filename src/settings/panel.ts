import * as vscode from 'vscode';
import { ProviderConnectionService, type ConnectionDraft } from '../model/connections.js';
import type { ProviderKind } from '../model/profiles.js';
import type { SettingsManager } from './configuration.js';
import { parseSettingsClientMessage, type LifecycleAction, type SafeConnection, type SettingsHostMessage } from './messages.js';

export type SettingsLifecycleHandler = (action: LifecycleAction) => Promise<string>;

export class SettingsPanel {
  private panel?: vscode.WebviewPanel;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly manager: SettingsManager,
    private readonly connections: ProviderConnectionService,
    private readonly onConnectionsChanged: () => Promise<void>,
    private readonly onSettingsChanged: () => void,
    private readonly onLifecycle: SettingsLifecycleHandler,
  ) {}

  show(): void {
    if (this.panel) { this.panel.reveal(); void this.sendState(); return; }
    this.panel = vscode.window.createWebviewPanel('lgs.settings', 'LGS Settings', vscode.ViewColumn.One, {
      enableScripts: true, localResourceRoots: [this.context.extensionUri], retainContextWhenHidden: true,
    });
    this.panel.onDidDispose(() => { this.panel = undefined; });
    this.panel.webview.onDidReceiveMessage((raw: unknown) => void this.receive(raw));
    this.panel.webview.html = this.html(this.panel.webview);
  }

  refresh(): void { void this.sendState(); }

  private send(value: SettingsHostMessage): void { void this.panel?.webview.postMessage(value); }

  private async state(): Promise<SettingsHostMessage> {
    const profiles = this.connections.profiles();
    const connections: SafeConnection[] = await Promise.all(profiles.map(async profile => ({
      ...profile,
      secretName: undefined,
      headers: safeHeaders(profile.headers),
      hasApiKey: await this.connections.hasApiKey(profile),
      status: this.connections.diagnostics.status(profile),
      models: this.connections.diagnostics.models(profile.id),
      statistics: this.connections.diagnostics.statistics(profile.id),
      activities: this.connections.diagnostics.activities(profile.id),
    })));
    return {
      type: 'state', settings: this.manager.effective(), errors: this.manager.errorsList(), connections,
      workspaceOpen: Boolean(this.manager.workspaceConfigPath()),
    };
  }

  private async sendState(): Promise<void> { if (this.panel) this.send(await this.state()); }

  private async receive(raw: unknown): Promise<void> {
    const message = parseSettingsClientMessage(raw);
    if (!message) { this.notice('LGS rejected an invalid Settings request.', 'error'); return; }
    try {
      if (message.type === 'refreshState') { await this.sendState(); return; }
      if (message.type === 'openWorkspaceConfig') { await this.openWorkspaceConfig(); return; }
      if (message.type === 'openUsage') { await vscode.commands.executeCommand('lgs.openUsage'); return; }
      if (message.type === 'setAppearance') {
        const workspaceOverride = Object.prototype.hasOwnProperty.call(this.manager.workspaceValues(), 'appearance.theme');
        const error = await this.manager.set('appearance.theme', message.theme, message.scope);
        if (error) this.notice(error, 'error');
        else {
          this.onSettingsChanged();
          this.notice(message.scope === 'user' && workspaceOverride
            ? 'User theme saved. The existing workspace theme remains active and takes precedence in this workspace.'
            : `Appearance updated for ${message.scope === 'user' ? 'your user profile' : 'this workspace'}.`, message.scope === 'user' && workspaceOverride ? 'warning' : 'success');
          await this.sendState();
        }
        return;
      }
      if (message.type === 'setSetting') {
        const error = await this.manager.set(message.id, message.value, message.scope);
        if (error) this.notice(error, 'error');
        else { this.onSettingsChanged(); this.notice('Setting saved.', 'success'); await this.sendState(); }
        return;
      }
      if (message.type === 'saveConnection') {
        const draft = connectionDraft(message.connection);
        const saved = await this.connections.save(draft);
        await this.onConnectionsChanged();
        this.notice(`${saved.name} saved. Stored secrets will not be returned to this view.`, 'success');
        await this.sendState(); return;
      }
      if (message.type === 'deleteConnection') {
        const deleted = await this.connections.delete(message.id);
        if (!deleted) this.notice('Connection not found.', 'error');
        else { await this.onConnectionsChanged(); this.notice('Connection and its LGS-managed secrets were removed.', 'success'); await this.sendState(); }
        return;
      }
      if (message.type === 'setConnectionEnabled') {
        const profile = await this.connections.setEnabled(message.id, message.enabled);
        if (!profile) this.notice('Connection not found.', 'error');
        else { await this.onConnectionsChanged(); this.notice(`${profile.name} ${message.enabled ? 'enabled' : 'disabled'}.`, 'success'); await this.sendState(); }
        return;
      }
      if (message.type === 'testConnection') {
        const result = await this.connections.test(message.id);
        await this.sendState(); this.send({ type: 'connectionResult', id: message.id, result }); return;
      }
      if (message.type === 'testDraftConnection') {
        const result = await this.connections.testDraft(connectionDraft(message.connection));
        this.send({ type: 'connectionResult', id: String(message.connection.id || 'draft'), result, draft: true }); return;
      }
      if (message.type === 'lifecycle') {
        const result = await this.onLifecycle(message.action);
        this.send({ type: 'lifecycleResult', action: message.action, ok: true, message: result });
        await this.sendState(); return;
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'The Settings operation failed.';
      if (message.type === 'lifecycle') this.send({ type: 'lifecycleResult', action: message.action, ok: false, message: messageText });
      else this.notice(messageText, 'error');
    }
  }

  private notice(message: string, tone: 'info' | 'success' | 'warning' | 'error' = 'info'): void { this.send({ type: 'notice', message, tone }); }

  private async openWorkspaceConfig(): Promise<void> {
    const file = this.manager.workspaceConfigPath();
    if (!file) { this.notice('Open a workspace to configure engineering systems.', 'error'); return; }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file)); await vscode.window.showTextDocument(document);
  }

  private html(webview: vscode.Webview): string {
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'settings.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'settings.css'));
    const nonce = Date.now().toString(36);
    return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'"><link rel="stylesheet" href="${style}"></head><body><div id="app"><div class="boot">Opening LGS Settings…</div></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
  }
}

function connectionDraft(value: Record<string, unknown>): ConnectionDraft {
  const kind = typeof value.kind === 'string' && ['ollama', 'openai', 'openai-compatible', 'anthropic'].includes(value.kind) ? value.kind as ProviderKind : undefined;
  return {
    id: text(value.id), name: text(value.name), kind, baseUrl: text(value.baseUrl), enabled: value.enabled !== false,
    apiKey: text(value.apiKey), removeApiKey: value.removeApiKey === true,
    headers: stringRecord(value.headers), secretHeaders: stringRecord(value.secretHeaders), secretHeaderNames: stringArray(value.secretHeaderNames),
    discoveryMode: value.discoveryMode === 'manual' || value.discoveryMode === 'disabled' ? value.discoveryMode : 'automatic',
    discoveryPath: text(value.discoveryPath), manualModels: stringArray(value.manualModels), modelAliases: stringRecord(value.modelAliases),
    capabilityOverrides: booleanRecord(value.capabilityOverrides), contextOverrides: numberRecord(value.contextOverrides),
    pricing: record(value.pricing) ? {
      billing: ['commercial', 'institution_provided', 'local', 'unknown'].includes(String(value.pricing.billing)) ? value.pricing.billing as 'commercial' | 'institution_provided' | 'local' | 'unknown' : 'unknown',
      inputPerMillionUsd: numberValue(value.pricing.inputPerMillionUsd), cachedInputPerMillionUsd: numberValue(value.pricing.cachedInputPerMillionUsd), outputPerMillionUsd: numberValue(value.pricing.outputPerMillionUsd),
    } : undefined,
    dataPolicy: ['local', 'cloud', 'repository_allowed', 'metadata_only'].includes(String(value.dataPolicy)) ? value.dataPolicy as ConnectionDraft['dataPolicy'] : undefined,
  };
}

function safeHeaders(headers: Record<string, string>): Record<string, string> { return Object.fromEntries(Object.entries(headers).filter(([name]) => !/authorization|api[-_]?key|token|secret|credential/i.test(name))); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function text(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
function numberValue(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined; }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean) : []; }
function stringRecord(value: unknown): Record<string, string> { return record(value) ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {}; }
function booleanRecord(value: unknown): Record<string, boolean> { return record(value) ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')) : {}; }
function numberRecord(value: unknown): Record<string, number> { return record(value) ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isInteger(entry[1]))) : {}; }
