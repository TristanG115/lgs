import type { ModelBackend } from '../model/backend.js';
import { textMessage } from '../model/types.js';
import { WATCHDOG_CLASSIFICATIONS, type WatchdogAnalyzer, type WatchdogFinding, type WatchdogInput } from './types.js';

export type WatchdogBackendResolver = (profileId: string) => ModelBackend | undefined | Promise<ModelBackend | undefined>;

export class BackendWatchdogAnalyzer implements WatchdogAnalyzer {
  private readonly backends = new Map<string, Promise<ModelBackend>>();
  constructor(private readonly profileId: string, private readonly model: string, private readonly resolveBackend: WatchdogBackendResolver) {}

  async analyze(input: WatchdogInput, signal = new AbortController().signal): Promise<WatchdogFinding> {
    const backend = await this.backend();
    const prompt = [
      'You are a lightweight read-only Watchdog. You never edit code or invoke tools.',
      'Classify whether work remains focused on the original objective.',
      `Allowed classifications: ${WATCHDOG_CLASSIFICATIONS.join(', ')}.`,
      'Return only JSON: {"classification":"ON_TRACK","evidence":[],"explanation":"","recommendedNextAction":""}.',
      `Compact task state: ${JSON.stringify(input)}`
    ].join('\n');
    let output = '';
    for await (const event of backend.streamChat(this.model, [textMessage('system', prompt)], { temperature: 0, maxTokens: 700 }, signal)) {
      if (event.type === 'textDelta') output += event.text;
      if (event.type === 'error') throw new Error(event.error.message);
    }
    return parseWatchdogFinding(output) ?? ruleBasedFinding(input);
  }

  private backend(): Promise<ModelBackend> {
    let backend = this.backends.get(this.profileId);
    if (!backend) {
      backend = Promise.resolve(this.resolveBackend(this.profileId)).then(value => {
        if (!value) throw new Error(`Watchdog provider profile was not found: ${this.profileId}.`);
        return value;
      });
      this.backends.set(this.profileId, backend);
    }
    return backend;
  }
}

export class RuleBasedWatchdogAnalyzer implements WatchdogAnalyzer {
  async analyze(input: WatchdogInput): Promise<WatchdogFinding> { return ruleBasedFinding(input); }
}

export function parseWatchdogFinding(output: string): WatchdogFinding | undefined {
  const candidate = output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const value = JSON.parse(candidate) as Record<string, unknown>;
    if (!WATCHDOG_CLASSIFICATIONS.includes(value.classification as never) || !Array.isArray(value.evidence) || value.evidence.some(item => typeof item !== 'string') || typeof value.explanation !== 'string' || typeof value.recommendedNextAction !== 'string') return;
    return { classification: value.classification as WatchdogFinding['classification'], evidence: boundedList(value.evidence as string[]), explanation: bounded(value.explanation), recommendedNextAction: bounded(value.recommendedNextAction) };
  } catch { return; }
}

export function ruleBasedFinding(input: WatchdogInput): WatchdogFinding {
  if (input.explicitUncertainty) return finding('NEEDS_RESEARCH', [input.explicitUncertainty], 'The main agent explicitly reported uncertainty.', 'Research the uncertain point or escalate it before continuing implementation.');
  if (substantiallyRepeated(input.recentFailures)) return finding('RECONSIDER_APPROACH', input.recentFailures.slice(-3), 'Recent verification failures are substantially repetitive.', 'Stop retrying the same fix and choose a materially different approach.');
  const missing = input.acceptanceCriteria.filter(criterion => !mentioned(criterion, [...input.completedWork, ...input.remainingWork]));
  if (missing.length) return finding('MISSING_REQUIREMENT', missing, 'Acceptance criteria are absent from both completed and remaining work.', `Add the missing ${missing.length === 1 ? 'criterion' : 'criteria'} to the plan and verify them.`);
  if (input.stalled && input.remainingWork.length) return finding('OFF_TRACK', input.remainingWork.slice(0, 5), 'Task state has not progressed while required work remains.', 'Resume with the highest-priority remaining item and produce concrete evidence.');
  return finding('ON_TRACK', input.completedWork.slice(-3), 'The plan and recorded progress remain aligned with the objective.', input.remainingWork[0] ?? 'Proceed to Completion Guard evaluation.');
}

function finding(classification: WatchdogFinding['classification'], evidence: string[], explanation: string, action: string): WatchdogFinding { return { classification, evidence: boundedList(evidence), explanation, recommendedNextAction: action }; }
function substantiallyRepeated(failures: string[]): boolean { if (failures.length < 2) return false; const normalized = failures.map(value => value.toLowerCase().replace(/\b\d+\b/g, '<n>').replace(/\s+/g, ' ').slice(0, 200)); return new Set(normalized.slice(-3)).size === 1; }
function mentioned(criterion: string, work: string[]): boolean {
  const words = [...new Set(criterion.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])];
  return words.length === 0 || work.some(item => words.filter(word => item.toLowerCase().includes(word)).length >= Math.ceil(words.length * 0.6));
}
function boundedList(values: string[]): string[] { return values.filter(Boolean).slice(0, 20).map(bounded); }
function bounded(value: string): string { return value.trim().slice(0, 1_000); }
