import type { ExecutionRequest, NormalizedCommandOutput } from './types.js';

const ERROR = /(^|\s)(error|failed|failure|fatal|exception|panic|assertionerror)(\s|:|$)/i;
const STACK = /^\s*(at\s+|File\s+"|Caused by:|\w*Error:)/;
const LOCATION = /(?:^|[\s("'])([\w./\\-]+\.[A-Za-z0-9]+(?::\d+){1,2})(?=$|[\s)"'])/g;
const MAX_STREAM_LINES = 24;

export function displayCommand(request: Pick<ExecutionRequest, 'executable' | 'args'>): string {
  return [request.executable, ...request.args].map(argument => /^[a-zA-Z0-9_./:=@+-]+$/.test(argument) ? argument : JSON.stringify(argument)).join(' ');
}

export function normalizeOutput(request: Pick<ExecutionRequest, 'executable' | 'args'>, exitCode: number | null, stdout: string, stderr: string): NormalizedCommandOutput {
  const stdoutLines = lines(stdout);
  const stderrLines = lines(stderr);
  const combined = [...stderrLines, ...stdoutLines];
  const primaryError = combined.find(line => ERROR.test(line)) ?? (exitCode && exitCode !== 0 ? combined.find(Boolean) : undefined);
  const relevantStack = unique(combined.filter(line => STACK.test(line))).slice(0, 16);
  const fileLocations = unique(combined.flatMap(line => [...line.matchAll(LOCATION)].map(match => match[1]))).slice(0, 24);
  const stdoutPreview = relevantPreview(stdoutLines);
  const stderrPreview = relevantPreview(stderrLines);
  return {
    command: displayCommand(request), exitCode, primaryError, relevantStack, fileLocations,
    stdout: stdoutPreview, stderr: stderrPreview,
    omittedLineCount: Math.max(0, stdoutLines.length - stdoutPreview.length) + Math.max(0, stderrLines.length - stderrPreview.length)
  };
}

function lines(value: string): string[] { return value.split(/\r?\n/).filter(Boolean); }
function unique(values: string[]): string[] { return [...new Set(values)]; }
function relevantPreview(values: string[]): string[] {
  if (values.length <= MAX_STREAM_LINES) return values;
  const important = values.filter(line => ERROR.test(line) || STACK.test(line) || hasLocation(line));
  return unique([...important.slice(0, 16), ...values.slice(-8)]).slice(0, MAX_STREAM_LINES);
}
function hasLocation(value: string): boolean { LOCATION.lastIndex = 0; return LOCATION.test(value); }
