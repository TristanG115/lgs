import * as fs from 'node:fs';
import * as path from 'node:path';

export type RawExecutionLog = { stdout: string; stderr: string };

export class RawExecutionLogStore {
  private readonly memory = new Map<string, RawExecutionLog>();
  constructor(private readonly workspaceRoot?: string) {}

  put(id: string, log: RawExecutionLog): string {
    this.memory.set(id, log);
    if (this.workspaceRoot) {
      const directory = path.join(this.workspaceRoot, '.lgs', 'logs');
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, id + '.json'), JSON.stringify(log));
    }
    return id;
  }

  get(id: string): RawExecutionLog | undefined {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) return undefined;
    const cached = this.memory.get(id);
    if (cached) return cached;
    if (!this.workspaceRoot) return undefined;
    try {
      const value = JSON.parse(fs.readFileSync(path.join(this.workspaceRoot, '.lgs', 'logs', id + '.json'), 'utf8')) as unknown;
      if (typeof value !== 'object' || value === null) return undefined;
      const log = value as Record<string, unknown>;
      if (typeof log.stdout !== 'string' || typeof log.stderr !== 'string') return undefined;
      return { stdout: log.stdout, stderr: log.stderr };
    } catch { return undefined; }
  }

  page(id: string, stream: 'stdout' | 'stderr', offset = 0, maxLines = 200): { lines: string[]; offset: number; nextOffset?: number; totalLines: number } | undefined {
    const log = this.get(id);
    if (!log) return undefined;
    const lines = log[stream].split(/\r?\n/);
    const boundedOffset = Math.max(0, Math.min(offset, lines.length));
    const count = Math.max(1, Math.min(maxLines, 400));
    const selected = lines.slice(boundedOffset, boundedOffset + count);
    const next = boundedOffset + selected.length;
    return { lines: selected, offset: boundedOffset, nextOffset: next < lines.length ? next : undefined, totalLines: lines.length };
  }
}

