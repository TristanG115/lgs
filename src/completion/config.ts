import { COMPLETION_REQUIREMENTS, type CompletionConfiguration, type CompletionGateConfiguration, type FailureBudgetConfiguration } from './types.js';

const DEFAULT_GATES: CompletionGateConfiguration = {
  acceptance_criteria_addressed: true,
  implementation_complete: true,
  relevant_tests_added_or_updated: true,
  targeted_tests_pass: true,
  full_tests_pass: true,
  typecheck_passes: true,
  lint_passes: true,
  build_succeeds: true,
  documentation_current: true,
  codebase_map_current: true,
  runtime_verification_passes: false,
  independent_review_passes: false,
  no_unresolved_task_failures: true
};
const DEFAULT_BUDGETS: FailureBudgetConfiguration = {
  same_error_retry_limit: 3,
  total_fix_attempt_limit: 12,
  escalation_threshold: 3
};

export function parseCompletionConfiguration(value: Record<string, unknown> = {}, errors: string[] = []): CompletionConfiguration {
  const gates = { ...DEFAULT_GATES };
  const failureBudgets = { ...DEFAULT_BUDGETS };
  if (value.gates !== undefined) {
    if (!record(value.gates)) errors.push('completion.gates must be a YAML object.');
    else for (const [requirement, required] of Object.entries(value.gates)) {
      if (!COMPLETION_REQUIREMENTS.includes(requirement as never) || typeof required !== 'boolean') errors.push(`Invalid completion gate: ${requirement}.`);
      else gates[requirement as keyof CompletionGateConfiguration] = required;
    }
  }
  if (value.failureBudgets !== undefined) {
    if (!record(value.failureBudgets)) errors.push('completion.failureBudgets must be a YAML object.');
    else {
      for (const key of Object.keys(value.failureBudgets)) if (!(key in DEFAULT_BUDGETS)) errors.push(`Unknown completion failure budget: ${key}.`);
      for (const key of Object.keys(DEFAULT_BUDGETS) as (keyof FailureBudgetConfiguration)[]) {
        const candidate = value.failureBudgets[key];
        if (candidate === undefined) continue;
        if (!Number.isInteger(candidate) || Number(candidate) < 1 || Number(candidate) > 1000) errors.push(`completion.failureBudgets.${key} must be an integer from 1 to 1000.`);
        else failureBudgets[key] = candidate as number;
      }
    }
  }
  return { gates, failureBudgets };
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
