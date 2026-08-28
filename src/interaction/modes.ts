import type { ExecutionMode, ExecutionModePolicy } from './types.js';

const POLICIES: Record<ExecutionMode, ExecutionModePolicy> = {
  normal: { id: 'normal', label: 'Normal', capabilities: ['inspect', 'edit', 'commands', 'verify'], requiresGoal: false, planBeforeMutation: false },
  plan: { id: 'plan', label: 'Plan', capabilities: ['inspect', 'plan'], requiresGoal: false, planBeforeMutation: true },
  web: { id: 'web', label: 'Web', capabilities: ['inspect', 'web'], requiresGoal: false, planBeforeMutation: false },
  research: { id: 'research', label: 'Research', capabilities: ['inspect', 'plan', 'edit', 'commands', 'web', 'verify', 'iterate'], requiresGoal: true, planBeforeMutation: true },
};

export function executionModePolicy(mode: ExecutionMode): ExecutionModePolicy { return POLICIES[mode]; }
export function modeAllows(mode: ExecutionMode, capability: ExecutionModePolicy['capabilities'][number]): boolean { return POLICIES[mode].capabilities.includes(capability); }
