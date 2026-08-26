import type { ExecutionResult } from '../execution/types.js';
import type { ExecutionEvidenceReader, FailureBudgetConfiguration, FailureBudgetState } from './types.js';

export class FailureBudgetTracker {
  constructor(private readonly evidence: ExecutionEvidenceReader, private readonly configuration: FailureBudgetConfiguration) {}

  state(taskId: string): FailureBudgetState {
    const failures = this.evidence.read(taskId).map(entry => entry.execution).filter(failedExecution);
    const counts = new Map<string, number>();
    for (const failure of failures) {
      const fingerprint = errorFingerprint(failure);
      counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1);
    }
    const dominant = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
    const largestSameErrorCount = dominant?.[1] ?? 0;
    const sameErrorExhausted = largestSameErrorCount >= this.configuration.same_error_retry_limit;
    const totalExhausted = failures.length >= this.configuration.total_fix_attempt_limit;
    return {
      totalFailures: failures.length, largestSameErrorCount, dominantError: dominant?.[0],
      exhausted: sameErrorExhausted || totalExhausted,
      escalationRequired: failures.length >= this.configuration.escalation_threshold,
      reason: sameErrorExhausted ? `The same substantial error reached the retry limit (${largestSameErrorCount}/${this.configuration.same_error_retry_limit}).`
        : totalExhausted ? `The total fix-attempt limit was reached (${failures.length}/${this.configuration.total_fix_attempt_limit}).` : undefined
    };
  }

  canAttempt(taskId?: string): { allowed: boolean; state?: FailureBudgetState } {
    if (!taskId) return { allowed: true };
    const state = this.state(taskId);
    return { allowed: !state.exhausted, state };
  }
}

export function errorFingerprint(result: ExecutionResult): string {
  const source = result.normalized.primaryError ?? result.normalized.stderr[0] ?? result.normalized.stdout[0] ?? result.status;
  return source.toLowerCase()
    .replace(/[a-f0-9]{8,}/g, '<id>')
    .replace(/(?:[a-z]:)?[\w./\\-]+\.[a-z0-9]+(?::\d+){0,2}/gi, '<file>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/\s+/g, ' ').trim().slice(0, 500);
}

function failedExecution(result: ExecutionResult): boolean { return result.status === 'failed' || result.status === 'spawn_error' || result.status === 'timed_out'; }

