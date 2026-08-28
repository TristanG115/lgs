import type { ConnectionTestResult, ProviderDiagnosticsStore } from '../model/diagnostics.js';
import type { BackendProfile } from '../model/profiles.js';
import type { LifecycleAction } from './messages.js';

export type LifecycleConnections = {
  profiles(): BackendProfile[];
  reconnectAll(): Promise<ConnectionTestResult[]>;
};

export type LifecycleViews = {
  restartServices(): Promise<string>;
  restartOwnedLocalRuntimes(): Promise<string>;
  reloadViews(): void;
  refreshConnections(): Promise<void>;
};

export class LgsLifecycleService {
  constructor(
    private readonly connections: LifecycleConnections,
    private readonly diagnostics: ProviderDiagnosticsStore,
    private readonly views: LifecycleViews,
    private readonly refreshSettings: () => void,
    private readonly reloadWindow: () => Promise<void>,
  ) {}

  async run(action: LifecycleAction): Promise<string> {
    if (action === 'restartServices') {
      const message = await this.views.restartServices(); await this.record(action, message); this.refreshSettings(); return message;
    }
    if (action === 'reconnectProviders') {
      const pending = this.connections.reconnectAll(); this.refreshSettings(); const results = await pending;
      await this.views.refreshConnections(); this.refreshSettings(); const online = results.filter(result => result.ok).length;
      const message = `Provider reconnect complete: ${online} online, ${results.length - online} requiring attention.`;
      await this.record(action, message); return message;
    }
    if (action === 'restartLocalRuntimes') {
      const message = await this.views.restartOwnedLocalRuntimes(); await this.record(action, message); return message;
    }
    if (action === 'reloadViews') {
      this.views.reloadViews(); this.refreshSettings(); const message = 'LGS views reloaded without reloading VS Code.';
      await this.record(action, message); return message;
    }
    await this.reloadWindow(); return 'VS Code window reload requested.';
  }

  private async record(action: LifecycleAction, message: string): Promise<void> {
    await Promise.all(this.connections.profiles().map(profile => this.diagnostics.record({
      connectionId: profile.id, type: 'lifecycle', operation: lifecycleLabel(action), result: 'info', message,
    })));
  }
}

function lifecycleLabel(action: LifecycleAction): string {
  return ({ restartServices: 'restart services', reconnectProviders: 'reconnect providers', restartLocalRuntimes: 'restart local runtimes', reloadViews: 'reload views', reloadWindow: 'reload VS Code window' })[action];
}
