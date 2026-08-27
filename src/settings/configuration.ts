import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse, stringify } from 'yaml';
import type * as vscode from 'vscode';
import { parseComputerConfiguration } from '../computer/config.js';
import { parseCompletionConfiguration } from '../completion/config.js';
import { parseOrchestrationConfiguration } from '../orchestration/config.js';
import { parseResearchConfiguration } from '../research/config.js';
import { parseRoutingConfiguration } from '../routing/config.js';
import { parseRuntimeConfiguration } from '../runtime/config.js';
import { parseUsageConfiguration } from '../usage/config.js';
import { loadWorkspaceConfiguration, type LoadedWorkspaceConfiguration } from '../verification/config.js';
import { parseWatchdogConfiguration } from '../watchdog/config.js';
import { parseContextLifecycleConfiguration } from '../context/lifecycle.js';
import { createDefaultRegistry } from './defaults.js';
import { resolveSetting, type EffectiveSetting, type SettingsRegistry } from './registry.js';

export class SettingsManager {
  readonly registry: SettingsRegistry = createDefaultRegistry();
  private workspace: Record<string, unknown> = {};
  private errors: string[] = [];
  private project?: LoadedWorkspaceConfiguration;

  constructor(private readonly context: vscode.ExtensionContext, private readonly root?: string) { this.reloadWorkspace(); }

  reloadWorkspace(): void {
    this.workspace = {}; this.errors = []; this.project = undefined;
    if (!this.root) return;
    this.project = loadWorkspaceConfiguration(this.root);
    this.workspace = this.project.settings; this.errors = this.project.errors;
  }

  workspaceConfiguration(): LoadedWorkspaceConfiguration {
    const project = this.project ?? {
      settings: {}, verification: {}, permissions: {}, completion: parseCompletionConfiguration(),
      agents: parseOrchestrationConfiguration(), watchdog: parseWatchdogConfiguration(),
      research: parseResearchConfiguration(), runtime: parseRuntimeConfiguration(),
      integrations: { required: [], recommended: [], optional: [], mcp: {} },
      routing: parseRoutingConfiguration(), usage: parseUsageConfiguration(),
      computer: parseComputerConfiguration(), context: parseContextLifecycleConfiguration(), errors: [],
    };
    const effective = new Map(this.effective().map(setting => [setting.id, setting]));
    const structuredComputer = this.structuredComputerKeys();
    const value = (key: keyof LoadedWorkspaceConfiguration['computer'], id: string) => {
      const setting = effective.get(id);
      return structuredComputer.has(key) || !setting || setting.source === 'built-in' ? project.computer[key] : setting.value;
    };
    const computer = parseComputerConfiguration({
      ...project.computer,
      readOutsideWorkspace: value('readOutsideWorkspace', 'computer.readOutsideWorkspace'),
      writeOutsideWorkspace: value('writeOutsideWorkspace', 'computer.writeOutsideWorkspace'),
      systemCommandPolicy: value('systemCommandPolicy', 'computer.systemCommandPolicy'),
      packageInstallationPolicy: value('packageInstallationPolicy', 'computer.packageInstallationPolicy'),
      elevatedCommandPolicy: value('elevatedCommandPolicy', 'computer.elevatedCommandPolicy'),
      externalDocumentAccess: value('externalDocumentAccess', 'computer.externalDocumentAccess'),
      dryRun: value('dryRun', 'computer.dryRun'),
      activityLogRetentionDays: value('activityLogRetentionDays', 'computer.activityLogRetentionDays'),
    });
    return { ...project, computer };
  }

  userValues(): Record<string, unknown> { return this.context.globalState.get<Record<string, unknown>>('lgs.settings') || {}; }
  workspaceValues(): Record<string, unknown> { return { ...this.workspace }; }
  errorsList(): string[] { return [...this.errors]; }
  effective(): EffectiveSetting[] { return this.registry.all().map(definition => resolveSetting(definition, this.userValues(), this.workspaceValues())); }

  async set(id: string, value: unknown, scope: 'user' | 'workspace'): Promise<string | undefined> {
    const definition = this.registry.get(id);
    if (!definition) return 'Unknown setting: ' + id;
    if (scope === 'user' && definition.scope === 'workspace') return 'This setting is workspace-only.';
    if (scope === 'workspace' && definition.scope === 'user') return 'This setting is user-only.';
    const error = definition.validate?.(value); if (error) return error;
    if (scope === 'user') {
      const values = this.userValues(); values[id] = value;
      await this.context.globalState.update('lgs.settings', values); return;
    }
    return this.writeWorkspace(config => {
      const settings = record(config.settings) ? config.settings : {};
      settings[id] = value; config.settings = settings;
    });
  }

  async setRouting(value: unknown): Promise<string | undefined> {
    const errors: string[] = []; parseRoutingConfiguration(record(value) ? value : {}, errors);
    if (errors.length) return errors[0];
    return this.writeWorkspace(config => { config.routing = value; });
  }

  workspaceConfigPath(): string | undefined { return this.root ? path.join(this.root, '.lgs', 'config.yaml') : undefined; }

  private structuredComputerKeys(): Set<string> {
    if (!this.root) return new Set();
    try {
      const parsed = parse(fs.readFileSync(path.join(this.root, '.lgs', 'config.yaml'), 'utf8')) as unknown;
      if (!record(parsed) || !record(parsed.computer)) return new Set();
      return new Set(Object.keys(parsed.computer));
    } catch { return new Set(); }
  }

  private async writeWorkspace(update: (config: Record<string, unknown>) => void): Promise<string | undefined> {
    if (!this.root) return 'No workspace is open.';
    try {
      const file = path.join(this.root, '.lgs', 'config.yaml');
      const current = fs.existsSync(file) ? parse(fs.readFileSync(file, 'utf8')) : {};
      const config = record(current) ? current : {};
      update(config); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, stringify(config));
      this.reloadWorkspace(); return;
    } catch (error) { return error instanceof Error ? error.message : 'Unable to save workspace settings.'; }
  }
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
