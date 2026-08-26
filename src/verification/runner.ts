import * as path from 'node:path';
import type { CommandExecutionService, ExecutionResult } from '../execution/index.js';
import type { CommandDefinition } from '../execution/types.js';
import type { VerificationConfiguration, VerificationStep } from './config.js';

export type VerificationRun = {
  step: VerificationStep;
  targets: string[];
  status: 'passed' | 'failed' | 'not_configured' | 'cancelled';
  executions: ExecutionResult[];
};

export class VerificationRunner {
  constructor(private readonly configuration: VerificationConfiguration, private readonly execution: CommandExecutionService) {}

  async run(step: VerificationStep, options: { targets?: string[]; taskId?: string; signal?: AbortSignal } = {}): Promise<VerificationRun> {
    const targets = unique((options.targets ?? []).map(normalizeTarget));
    const configured = this.configuration[step] ?? [];
    const selected = step === 'targetedTest' && targets.length ? configured.filter(command => matchesTargets(command, targets)) : configured;
    if (!selected.length) return { step, targets, status: 'not_configured', executions: [] };
    const executions: ExecutionResult[] = [];
    for (const command of selected) {
      const definition = { ...command };
      delete definition.include;
      const result = await this.execution.execute({
        ...definition, args: expandTargets(command.args, targets), taskId: options.taskId, verificationStep: step
      }, options.signal);
      executions.push(result);
      if (result.status !== 'passed') return { step, targets, status: result.status === 'cancelled' ? 'cancelled' : 'failed', executions };
    }
    return { step, targets, status: 'passed', executions };
  }
}

function expandTargets(arguments_: string[], targets: string[]): string[] {
  return arguments_.flatMap(argument => argument === '{targets}' ? targets : [argument.replaceAll('{targetCount}', String(targets.length))]);
}
function matchesTargets(command: CommandDefinition, targets: string[]): boolean {
  return !command.include?.length || targets.some(target => command.include!.some(pattern => globMatch(target, pattern)));
}
function globMatch(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('**', '\u0000').replaceAll('*', '[^/]*').replaceAll('\u0000', '.*').replaceAll('?', '[^/]');
  return new RegExp('^' + escaped + '$').test(value);
}
function normalizeTarget(target: string): string {
  if (typeof target !== 'string' || target.includes('\0')) throw new Error('Verification targets must be strings without null bytes.');
  const normalized = target.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || path.posix.isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized) || normalized.split('/').includes('..')) throw new Error('Verification targets must be workspace-relative paths.');
  return normalized;
}
function unique(values: string[]): string[] { return [...new Set(values)]; }
