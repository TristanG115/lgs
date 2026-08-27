import type { ModelBackend } from './backend.js';
import { createBackend, type BackendProfile } from './profiles.js';
import type { ConnectionState, GenerationOptions, LgsMessage, ModelCapabilities, ModelInfo, StreamEvent } from './types.js';

export type BackendId = string;
export type BackendObservation = { type: 'connecting' | 'connected' | 'done' | 'error'; operation: 'chat'; error?: unknown; model: string; durationMs?: number };

export const createBackends = (
  profiles: BackendProfile[],
  secret: (profile: BackendProfile) => string | undefined,
  secretHeaders: (profile: BackendProfile) => Record<string, string> = () => ({}),
  observe?: (profile: BackendProfile, event: BackendObservation) => void,
): Map<string, ModelBackend> => new Map(profiles.filter(profile => profile.enabled).map(profile => {
  const backend = createBackend(profile, secret(profile), secretHeaders(profile));
  return [profile.id, observe ? new ObservedBackend(profile, backend, observe) : backend];
}));

class ObservedBackend implements ModelBackend {
  readonly id: string; readonly displayName: string; readonly capabilities: ModelCapabilities;
  constructor(private readonly profile: BackendProfile, private readonly backend: ModelBackend, private readonly observe: (profile: BackendProfile, event: BackendObservation) => void) {
    this.id = backend.id; this.displayName = backend.displayName; this.capabilities = backend.capabilities;
  }
  getConnectionState(): ConnectionState { return this.backend.getConnectionState(); }
  listModels(signal?: AbortSignal): Promise<ModelInfo[]> { return this.backend.listModels(signal); }
  probeModels(signal?: AbortSignal): Promise<ModelInfo[]> { return this.backend.probeModels ? this.backend.probeModels(signal) : this.backend.listModels(signal); }
  async *streamChat(model: string, messages: LgsMessage[], options?: GenerationOptions, signal?: AbortSignal): AsyncIterable<StreamEvent> {
    const started = performance.now(); this.observe(this.profile, { type: 'connecting', operation: 'chat', model });
    for await (const event of this.backend.streamChat(model, messages, options, signal)) {
      if (event.type === 'connected') this.observe(this.profile, { type: 'connected', operation: 'chat', model });
      if (event.type === 'done') this.observe(this.profile, { type: 'done', operation: 'chat', model, durationMs: Math.round(performance.now() - started) });
      if (event.type === 'error') this.observe(this.profile, { type: 'error', operation: 'chat', model, error: event.error, durationMs: Math.round(performance.now() - started) });
      yield event;
    }
  }
}
