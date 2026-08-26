import { describe, expect, it } from 'vitest';
import type { ModelBackend } from '../src/model/backend.js';
import { textFromMessage, textMessage, type StreamEvent } from '../src/model/types.js';
import {
  BackendAgentInference, Orchestrator, parseOrchestrationConfiguration,
  type AgentInference, type AgentInferenceRequest
} from '../src/orchestration/index.js';

const REPORT = JSON.stringify({
  findings: ['Found the entry point.'], relevantFiles: ['src/main.ts'], workPerformed: ['Inspected imports.'],
  risks: [], unresolvedQuestions: [], recommendation: 'Update the caller.'
});

class RecordingInference implements AgentInference {
  readonly calls: AgentInferenceRequest[] = [];
  constructor(private readonly behavior: (request: AgentInferenceRequest) => Promise<string> = async () => REPORT) {}
  async run(request: AgentInferenceRequest): Promise<string> { this.calls.push(request); return this.behavior(request); }
}

function configuration(overrides: Record<string, unknown> = {}) { return parseOrchestrationConfiguration(overrides); }
function manager(orchestrator: Orchestrator) { return orchestrator.createAgent({ role: 'manager', initialContext: [textMessage('user', 'Phase 10')] }); }

describe('agent orchestration', () => {
  it('runs the create, assign, gather, and destroy lifecycle with compact reports', async () => {
    const inference = new RecordingInference();
    const orchestrator = new Orchestrator(inference, configuration(), { profileId: 'local', model: 'manager-model' });
    const parent = manager(orchestrator);
    const worker = orchestrator.createAgent({ role: 'explorer', parentId: parent.id });
    const report = await orchestrator.assignSubtask(worker.id, { objective: 'Locate the entry point.' });
    expect(report).toMatchObject({ findings: ['Found the entry point.'], relevantFiles: ['src/main.ts'], recommendation: 'Update the caller.' });
    expect(orchestrator.getAgent(worker.id)?.state).toBe('completed');
    expect(orchestrator.gatherReports(parent.id, [worker.id])).toEqual([report]);
    expect(orchestrator.destroyAgent(worker.id)).toBe(true);
    expect(orchestrator.getAgent(worker.id)).toBeUndefined();
  });

  it('cancels running inference and retains a cancelled lifecycle state', async () => {
    const inference = new RecordingInference(request => new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => {
      const error = new Error('cancelled'); error.name = 'AbortError'; reject(error);
    }, { once: true })));
    const orchestrator = new Orchestrator(inference, configuration(), { profileId: 'local', model: 'shared' });
    const worker = orchestrator.createAgent({ role: 'researcher' });
    const pending = orchestrator.assignSubtask(worker.id, { objective: 'Research the API.' });
    expect(orchestrator.cancelAgent(worker.id)).toBe(true);
    await expect(pending).rejects.toThrow('cancelled');
    expect(orchestrator.getAgent(worker.id)).toMatchObject({ state: 'cancelled' });
  });

  it('contains worker failures and returns failure results to the Manager', async () => {
    const inference = new RecordingInference(async () => { throw new Error('backend unavailable'); });
    const orchestrator = new Orchestrator(inference, configuration(), { profileId: 'local', model: 'shared' });
    const parent = manager(orchestrator);
    const results = await orchestrator.runSubtasks(parent.id, [{ role: 'debugger', objective: 'Diagnose the failure.' }], undefined, false);
    expect(results).toMatchObject([{ role: 'debugger', status: 'failed', error: 'backend unavailable' }]);
    expect(orchestrator.getAgent(results[0].agentId)?.state).toBe('failed');
  });

  it('keeps worker contexts isolated and copies caller-owned messages', async () => {
    const inference = new RecordingInference();
    const orchestrator = new Orchestrator(inference, configuration(), { profileId: 'local', model: 'shared' });
    const firstContext = textMessage('user', 'alpha-only');
    const first = orchestrator.createAgent({ role: 'explorer', initialContext: [firstContext] });
    const second = orchestrator.createAgent({ role: 'reviewer', initialContext: [textMessage('user', 'beta-only')] });
    (firstContext.content[0] as { type: 'text'; text: string }).text = 'mutated';
    await Promise.all([
      orchestrator.assignSubtask(first.id, { objective: 'Explore.', context: [textMessage('user', 'first-task')] }),
      orchestrator.assignSubtask(second.id, { objective: 'Review.', context: [textMessage('user', 'second-task')] })
    ]);
    const firstText = inference.calls[0].messages.map(textFromMessage).join('|');
    const secondText = inference.calls[1].messages.map(textFromMessage).join('|');
    expect(firstText).toContain('alpha-only'); expect(firstText).not.toContain('beta-only'); expect(firstText).not.toContain('mutated');
    expect(secondText).toContain('beta-only'); expect(secondText).not.toContain('alpha-only');
  });

  it('shares one provider backend across independent sessions using the same model', async () => {
    let resolutions = 0;
    const calls: string[] = [];
    const backend: ModelBackend = {
      id: 'local', displayName: 'Local', capabilities: { streaming: true, multimodal: false, systemInstructions: true, cancellation: true, usage: false },
      getConnectionState: () => 'connected', listModels: async () => [{ id: 'shared' }],
      async *streamChat(model: string): AsyncIterable<StreamEvent> { calls.push(model); yield { type: 'textDelta', text: REPORT }; yield { type: 'done' }; }
    };
    const inference = new BackendAgentInference(() => { resolutions++; return backend; });
    const orchestrator = new Orchestrator(inference, configuration({ readOnlyConcurrency: 2 }), { profileId: 'local', model: 'shared' });
    const one = orchestrator.createAgent({ role: 'explorer' });
    const two = orchestrator.createAgent({ role: 'reviewer' });
    await Promise.all([orchestrator.assignSubtask(one.id, { objective: 'Explore.' }), orchestrator.assignSubtask(two.id, { objective: 'Review.' })]);
    expect(resolutions).toBe(1);
    expect(calls).toEqual(['shared', 'shared']);
    expect(one.id).not.toBe(two.id);
  });

  it('serializes write-capable workers and honors provider-aware role mappings', async () => {
    let active = 0, maximum = 0;
    const inference = new RecordingInference(async () => {
      active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--; return REPORT;
    });
    const config = configuration({ roleModels: { implementer: { profileId: 'remote-profile', model: 'code-model' } }, readOnlyConcurrency: 4 });
    const orchestrator = new Orchestrator(inference, config, { profileId: 'local', model: 'manager-model' });
    const first = orchestrator.createAgent({ role: 'implementer' });
    const second = orchestrator.createAgent({ role: 'documentation-agent' });
    await Promise.all([orchestrator.assignSubtask(first.id, { objective: 'Implement.' }), orchestrator.assignSubtask(second.id, { objective: 'Document.' })]);
    expect(maximum).toBe(1);
    expect(orchestrator.getAgent(first.id)?.model).toEqual({ profileId: 'remote-profile', model: 'code-model' });
    expect(orchestrator.getAgent(second.id)?.model).toEqual({ profileId: 'local', model: 'manager-model' });
  });
});
