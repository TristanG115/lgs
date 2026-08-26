import type { ContinuationContext } from './types.js';

export function renderContinuationInstruction(context: ContinuationContext): string {
  const remaining = context.completion?.outstanding ?? [];
  const failed = context.failedVerification ?? remaining.filter(item => /failed|failure|test|typecheck|lint|build/i.test(item));
  const lines = [context.completion?.status === 'blocked' ? 'COMPLETION_BLOCKED' : 'CONTINUE_WORKING', '', 'LGS has determined that the task is not ready to conclude.'];
  if (remaining.length) lines.push('', 'Remaining criteria:', ...remaining.map(item => `- ${item}`));
  if (context.watchdog && context.watchdog.classification !== 'ON_TRACK') {
    lines.push('', `Watchdog: ${context.watchdog.classification}`, `- ${context.watchdog.explanation}`);
    for (const evidence of context.watchdog.evidence) lines.push(`- Evidence: ${evidence}`);
    lines.push(`- Next action: ${context.watchdog.recommendedNextAction}`);
  }
  if (failed.length) lines.push('', 'Failed verification to resolve:', ...failed.map(item => `- ${item}`));
  lines.push('', 'Continue working. Follow the recommended next action and do not claim completion until LGS passes every required gate.');
  return lines.join('\n');
}
