import type { RuntimeConfiguration, RuntimeHealthcheck, RuntimeStartConfiguration, BrowserAcceptanceCheck } from './types.js';

export function parseRuntimeConfiguration(value: unknown = undefined, errors: string[] = []): RuntimeConfiguration {
  if (value === undefined) return {};
  if (!record(value)) { errors.push('runtime must be a YAML object.'); return {}; }
  const unknown = Object.keys(value).filter(key => !['start', 'healthcheck', 'acceptance', 'browser'].includes(key));
  if (unknown.length) errors.push(`runtime contains unknown fields: ${unknown.join(', ')}.`);
  const start = value.start === undefined ? undefined : parseStart(value.start, errors);
  const healthcheck = value.healthcheck === undefined ? undefined : parseHealthcheck(value.healthcheck, errors);
  const acceptance = value.acceptance === undefined ? undefined : parseAcceptance(value.acceptance, errors);
  const browser = value.browser === undefined ? undefined : parseBrowser(value.browser, errors);
  return { ...(start ? { start } : {}), ...(healthcheck ? { healthcheck } : {}), ...(acceptance ? { acceptance } : {}), ...(browser ? { browser } : {}) };
}

function parseStart(value: unknown, errors: string[]): RuntimeStartConfiguration | undefined {
  if (!record(value)) { errors.push('runtime.start must be an object.'); return; }
  const unknown = Object.keys(value).filter(key => !['command', 'args', 'cwd', 'env', 'timeoutMs'].includes(key));
  if (unknown.length || typeof value.command !== 'string' || !value.command.trim() || !Array.isArray(value.args) || value.args.some(arg => typeof arg !== 'string')) { errors.push('runtime.start requires command and args, with only command, args, cwd, env, and timeoutMs allowed.'); return; }
  if (value.cwd !== undefined && typeof value.cwd !== 'string') { errors.push('runtime.start.cwd must be a string.'); return; }
  if (value.env !== undefined && (!record(value.env) || Object.values(value.env).some(entry => typeof entry !== 'string'))) { errors.push('runtime.start.env must contain string values.'); return; }
  if (value.timeoutMs !== undefined && (!Number.isInteger(value.timeoutMs) || Number(value.timeoutMs) < 1 || Number(value.timeoutMs) > 1_800_000)) { errors.push('runtime.start.timeoutMs must be an integer from 1 to 1800000.'); return; }
  return { command: value.command, args: value.args as string[], cwd: value.cwd as string | undefined, env: value.env as Record<string, string> | undefined, timeoutMs: value.timeoutMs as number | undefined };
}
function parseHealthcheck(value: unknown, errors: string[]): RuntimeHealthcheck | undefined {
  if (!record(value) || typeof value.url !== 'string' || !/^https?:\/\//.test(value.url) || !Number.isInteger(value.expectedStatus)) { errors.push('runtime.healthcheck requires an http(s) url and integer expectedStatus.'); return; }
  if (value.timeoutMs !== undefined && (!Number.isInteger(value.timeoutMs) || Number(value.timeoutMs) < 1 || Number(value.timeoutMs) > 300_000)) { errors.push('runtime.healthcheck.timeoutMs must be an integer from 1 to 300000.'); return; }
  if (value.intervalMs !== undefined && (!Number.isInteger(value.intervalMs) || Number(value.intervalMs) < 10 || Number(value.intervalMs) > 60_000)) { errors.push('runtime.healthcheck.intervalMs must be an integer from 10 to 60000.'); return; }
  return { url: value.url, expectedStatus: value.expectedStatus as number, timeoutMs: value.timeoutMs as number | undefined, intervalMs: value.intervalMs as number | undefined };
}
function parseAcceptance(value: unknown, errors: string[]): BrowserAcceptanceCheck[] | undefined {
  if (!Array.isArray(value)) { errors.push('runtime.acceptance must be an array.'); return; }
  const allowed = new Set(['browser_open', 'browser_click', 'browser_type', 'browser_get_text', 'browser_wait_for', 'browser_console', 'browser_network_errors']);
  const checks: BrowserAcceptanceCheck[] = [];
  for (const [index, item] of value.entries()) {
    if (!record(item) || !allowed.has(item.type as string)) { errors.push(`runtime.acceptance[${index}] has an invalid type.`); continue; }
    if (item.url !== undefined && typeof item.url !== 'string' || item.selector !== undefined && typeof item.selector !== 'string' || item.text !== undefined && typeof item.text !== 'string' || item.expectedText !== undefined && typeof item.expectedText !== 'string' || item.timeoutMs !== undefined && (!Number.isInteger(item.timeoutMs) || Number(item.timeoutMs) < 1) || item.expectedErrors !== undefined && (!Number.isInteger(item.expectedErrors) || Number(item.expectedErrors) < 0)) { errors.push(`runtime.acceptance[${index}] has invalid fields.`); continue; }
    checks.push(item as BrowserAcceptanceCheck);
  }
  return checks;
}
function parseBrowser(value: unknown, errors: string[]): RuntimeConfiguration['browser'] | undefined {
  if (!record(value) || value.headless !== undefined && typeof value.headless !== 'boolean' || value.timeoutMs !== undefined && (!Number.isInteger(value.timeoutMs) || Number(value.timeoutMs) < 1 || Number(value.timeoutMs) > 300_000)) { errors.push('runtime.browser accepts headless and timeoutMs.'); return; }
  return { headless: value.headless as boolean | undefined, timeoutMs: value.timeoutMs as number | undefined };
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
