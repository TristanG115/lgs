import type { CompletionEvaluation } from '../completion/types.js';
import type { ToolResult } from '../tools/types.js';
import type { EscalationTrigger, WatchdogFinding } from './types.js';

export function detectEscalationTriggers(options: { results?: ToolResult[]; responseText?: string; completion?: CompletionEvaluation; watchdog?: WatchdogFinding }): { trigger: EscalationTrigger; reason: string }[] {
  const triggers: { trigger: EscalationTrigger; reason: string }[] = [];
  const completion = options.completion;
  if (completion?.failureBudget.exhausted) triggers.push({ trigger: 'retry_exhaustion', reason: completion.failureBudget.reason ?? 'The configured retry budget was exhausted.' });
  else if ((completion?.failureBudget.largestSameErrorCount ?? 0) >= 2) triggers.push({ trigger: 'repeated_failure', reason: 'Substantially repeated verification failures were detected.' });
  if (options.results?.some(result => result.error?.code === 'invalid_request')) triggers.push({ trigger: 'invalid_tool_request', reason: 'The agent issued an invalid tool request.' });
  if (options.results?.some(reviewerRejected)) triggers.push({ trigger: 'reviewer_rejection', reason: 'An independent Reviewer report rejected the current work.' });
  if (completion?.outstanding.length) triggers.push({ trigger: 'unresolved_criteria', reason: completion.outstanding.join('; ') });
  if (options.responseText && /\b(?:i am|i'm|we are|we're)\s+(?:not sure|uncertain)|\bunclear\b|\bneed clarification\b/i.test(options.responseText)) triggers.push({ trigger: 'explicit_uncertainty', reason: 'The active agent explicitly expressed uncertainty.' });
  if (options.watchdog && options.watchdog.classification !== 'ON_TRACK') triggers.push({ trigger: 'watchdog_recommendation', reason: `${options.watchdog.classification}: ${options.watchdog.recommendedNextAction}` });
  return [...new Map(triggers.map(value => [value.trigger, value])).values()];
}

function reviewerRejected(result: ToolResult): boolean {
  if (result.toolId !== 'delegate_subtasks' || result.status !== 'success') return false;
  const text = JSON.stringify(result.data).toLowerCase();
  return text.includes('"role":"reviewer"') && /reject|not approved|changes required/.test(text);
}
