import type { ModelBackend } from '../model/backend.js';
import { textMessage } from '../model/types.js';
import type { AgentInference, AgentInferenceRequest } from './types.js';

export type AgentBackendResolver = (profileId: string) => ModelBackend | undefined | Promise<ModelBackend | undefined>;

export class BackendAgentInference implements AgentInference {
  private readonly backends = new Map<string, Promise<ModelBackend>>();
  constructor(private readonly resolveBackend: AgentBackendResolver) {}

  async run(request: AgentInferenceRequest): Promise<string> {
    const backend = await this.backend(request.model.profileId);
    let output = '';
    let failure: string | undefined;
    for await (const event of backend.streamChat(request.model.model, [textMessage('system', agentInstructions(request.role, request.objective)), ...request.messages], {}, request.signal)) {
      if (event.type === 'textDelta') output += event.text;
      if (event.type === 'error') failure = event.error.message;
    }
    if (failure) throw new Error(failure);
    return output;
  }

  private backend(profileId: string): Promise<ModelBackend> {
    let backend = this.backends.get(profileId);
    if (!backend) {
      backend = Promise.resolve(this.resolveBackend(profileId)).then(value => {
        if (!value) throw new Error(`Agent provider profile was not found: ${profileId}.`);
        return value;
      });
      this.backends.set(profileId, backend);
    }
    return backend;
  }
}

function agentInstructions(role: string, objective: string): string {
  return [
    `You are the ${role} worker in a bounded software-engineering delegation.`,
    `Objective: ${objective}`,
    'Work only from the isolated context provided. Do not claim work or verification you did not perform.',
    'Return only one compact JSON object with these exact fields:',
    '{"findings":[],"relevantFiles":[],"workPerformed":[],"risks":[],"unresolvedQuestions":[],"recommendation":""}',
    'Use short strings. Never include your transcript or hidden reasoning.'
  ].join('\n');
}
