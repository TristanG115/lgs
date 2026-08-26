import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse } from 'yaml';
import { COMMAND_CATEGORIES, type CommandDefinition, type PermissionConfiguration, type PermissionPolicy } from '../execution/types.js';
import { parseCompletionConfiguration } from '../completion/config.js';
import type { CompletionConfiguration } from '../completion/types.js';
import { parseOrchestrationConfiguration } from '../orchestration/config.js';
import type { OrchestrationConfiguration } from '../orchestration/types.js';
import { parseWatchdogConfiguration } from '../watchdog/config.js';
import type { WatchdogConfiguration } from '../watchdog/types.js';
import { parseResearchConfiguration } from '../research/config.js';
import type { ResearchConfiguration } from '../research/types.js';
import { parseRuntimeConfiguration } from '../runtime/config.js';
import type { RuntimeConfiguration } from '../runtime/types.js';
import type { IntegrationConfiguration } from '../integrations/types.js';

export const VERIFICATION_STEPS = ['install', 'typecheck', 'lint', 'targetedTest', 'test', 'build', 'start'] as const;
export type VerificationStep = typeof VERIFICATION_STEPS[number];
export type VerificationConfiguration = Partial<Record<VerificationStep, CommandDefinition[]>>;
export type WorkspaceConfiguration = {
  settings?: Record<string, unknown>;
  verification?: Record<string, unknown>;
  permissions?: { commands?: PermissionConfiguration };
  completion?: Record<string, unknown>;
  agents?: Record<string, unknown>;
  watchdog?: Record<string, unknown>;
  research?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
  integrations?: Record<string, unknown>;
};
export type LoadedWorkspaceConfiguration = {
  settings: Record<string, unknown>;
  verification: VerificationConfiguration;
  permissions: PermissionConfiguration;
  completion: CompletionConfiguration;
  agents: OrchestrationConfiguration;
  watchdog: WatchdogConfiguration;
  research: ResearchConfiguration;
  runtime: RuntimeConfiguration;
  integrations?: IntegrationConfiguration;
  errors: string[];
};

export function loadWorkspaceConfiguration(root: string): LoadedWorkspaceConfiguration {
  const empty: LoadedWorkspaceConfiguration = { settings: {}, verification: {}, permissions: {}, completion: parseCompletionConfiguration(), agents: parseOrchestrationConfiguration(), watchdog: parseWatchdogConfiguration(), research: parseResearchConfiguration(), runtime: parseRuntimeConfiguration(), integrations: { required: [], recommended: [], optional: [], mcp: {} }, errors: [] };
  const file = path.join(root, '.lgs', 'config.yaml');
  if (!fs.existsSync(file)) return empty;
  try {
    const parsed = parse(fs.readFileSync(file, 'utf8')) as unknown;
    if (!record(parsed)) throw new Error('Workspace config must be a YAML object.');
    const settings = parsed.settings === undefined ? {} : requireRecord(parsed.settings, 'settings');
    const rawCompletion = parsed.completion === undefined ? {} : requireRecord(parsed.completion, 'completion');
    const rawAgents = parsed.agents === undefined ? {} : requireRecord(parsed.agents, 'agents');
    const rawWatchdog = parsed.watchdog === undefined ? {} : requireRecord(parsed.watchdog, 'watchdog');
    const rawResearch = parsed.research === undefined ? {} : requireRecord(parsed.research, 'research');
    const rawRuntime = parsed.runtime;
    const verification = parseVerification(parsed.verification, empty.errors);
    const permissions = parsePermissions(parsed.permissions, empty.errors);
    const completion = parseCompletionConfiguration(rawCompletion, empty.errors);
    const agents = parseOrchestrationConfiguration(rawAgents, empty.errors);
    const watchdog = parseWatchdogConfiguration(rawWatchdog, empty.errors);
    const research = parseResearchConfiguration(rawResearch, empty.errors);
    const runtime = parseRuntimeConfiguration(rawRuntime, empty.errors);
    const integrations = parseIntegrations(parsed.integrations, empty.errors);
    return { settings, verification, permissions, completion, agents, watchdog, research, runtime, integrations, errors: empty.errors };
  } catch (error) {
    empty.errors.push(error instanceof Error ? error.message : 'Malformed workspace configuration.');
    return empty;
  }
}

function parseIntegrations(value: unknown, errors: string[]): IntegrationConfiguration { const empty = { required: [], recommended: [], optional: [], mcp: {} }; if (value === undefined) return empty; if (!record(value)) { errors.push('integrations must be a YAML object.'); return empty; } const names = (key: 'required'|'recommended'|'optional') => Array.isArray(value[key]) && value[key].every(item => typeof item === 'string') ? [...new Set(value[key] as string[])].slice(0, 100) : value[key] === undefined ? [] : (errors.push(`integrations.${key} must be an array of strings.`), []); return { ...empty, required: names('required'), recommended: names('recommended'), optional: names('optional') }; }

function parseVerification(value: unknown, errors: string[]): VerificationConfiguration {
  if (value === undefined) return {};
  if (!record(value)) { errors.push('The verification field must be a YAML object.'); return {}; }
  const result: VerificationConfiguration = {};
  for (const [step, raw] of Object.entries(value)) {
    if (!VERIFICATION_STEPS.includes(step as VerificationStep)) { errors.push(`Unknown verification step: ${step}.`); continue; }
    const definitions = Array.isArray(raw) ? raw : [raw];
    const parsed = definitions.flatMap((definition, index) => {
      const command = parseCommand(definition, `verification.${step}[${index}]`, errors);
      return command ? [command] : [];
    });
    if (parsed.length) result[step as VerificationStep] = parsed;
  }
  return result;
}

function parseCommand(value: unknown, location: string, errors: string[]): CommandDefinition | undefined {
  if (!record(value)) { errors.push(`${location} must be a command object.`); return; }
  const allowed = new Set(['executable', 'args', 'cwd', 'env', 'timeoutMs', 'category', 'include']);
  const unknown = Object.keys(value).filter(key => !allowed.has(key));
  if (unknown.length) { errors.push(`${location} contains unknown fields: ${unknown.join(', ')}.`); return; }
  if (typeof value.executable !== 'string' || !value.executable.trim()) { errors.push(`${location}.executable must be a non-empty string.`); return; }
  if (!Array.isArray(value.args) || value.args.some(argument => typeof argument !== 'string')) { errors.push(`${location}.args must be an array of strings.`); return; }
  if (!COMMAND_CATEGORIES.includes(value.category as never)) { errors.push(`${location}.category is invalid.`); return; }
  if (value.cwd !== undefined && typeof value.cwd !== 'string') { errors.push(`${location}.cwd must be a string.`); return; }
  if (value.timeoutMs !== undefined && (!Number.isInteger(value.timeoutMs) || Number(value.timeoutMs) < 1 || Number(value.timeoutMs) > 1_800_000)) { errors.push(`${location}.timeoutMs must be an integer from 1 to 1800000.`); return; }
  if (value.env !== undefined && (!record(value.env) || Object.values(value.env).some(entry => typeof entry !== 'string'))) { errors.push(`${location}.env must contain string values.`); return; }
  if (value.include !== undefined && (!Array.isArray(value.include) || value.include.some(entry => typeof entry !== 'string'))) { errors.push(`${location}.include must be an array of glob strings.`); return; }
  return {
    executable: value.executable, args: value.args as string[], category: value.category as CommandDefinition['category'],
    cwd: value.cwd as string | undefined, timeoutMs: value.timeoutMs as number | undefined,
    env: value.env as Record<string, string> | undefined, include: value.include as string[] | undefined
  };
}

function parsePermissions(value: unknown, errors: string[]): PermissionConfiguration {
  if (value === undefined) return {};
  if (!record(value)) { errors.push('The permissions field must be a YAML object.'); return {}; }
  const commands = value.commands;
  if (commands === undefined) return {};
  if (!record(commands)) { errors.push('permissions.commands must be a YAML object.'); return {}; }
  const result: PermissionConfiguration = {};
  if (commands.default !== undefined) {
    if (policy(commands.default)) result.default = commands.default;
    else errors.push('permissions.commands.default must be always_allow, ask, or deny.');
  }
  if (commands.categories !== undefined) {
    if (!record(commands.categories)) errors.push('permissions.commands.categories must be an object.');
    else {
      result.categories = {};
      for (const [category, candidate] of Object.entries(commands.categories)) {
        if (!COMMAND_CATEGORIES.includes(category as never) || !policy(candidate)) errors.push(`Invalid command category policy: ${category}.`);
        else result.categories[category as CommandDefinition['category']] = candidate;
      }
    }
  }
  if (commands.executables !== undefined) {
    if (!record(commands.executables)) errors.push('permissions.commands.executables must be an object.');
    else {
      result.executables = {};
      for (const [executable, candidate] of Object.entries(commands.executables)) {
        if (!executable || !policy(candidate)) errors.push(`Invalid executable command policy: ${executable || '(empty)'}.`);
        else result.executables[executable] = candidate;
      }
    }
  }
  return result;
}

function policy(value: unknown): value is PermissionPolicy { return value === 'always_allow' || value === 'ask' || value === 'deny'; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function requireRecord(value: unknown, name: string): Record<string, unknown> { if (!record(value)) throw new Error(`The ${name} field must be a YAML object.`); return value; }
