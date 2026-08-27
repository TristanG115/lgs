import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PricingEntry, UsageConfiguration, UsageRecord } from './types.js';

export class FileUsageStore {
  constructor(private readonly workspaceRoot: string) {}
  append(record: UsageRecord): void { fs.mkdirSync(path.dirname(this.file()), { recursive: true }); fs.appendFileSync(this.file(), JSON.stringify(record) + '\n'); }
  read(): UsageRecord[] { try { return fs.readFileSync(this.file(), 'utf8').split('\n').flatMap(line => { try { const value = JSON.parse(line) as unknown; return validRecord(value) ? [value] : []; } catch { return []; } }); } catch { return []; } }
  cleanup(configuration: UsageConfiguration, now = Date.now()): number { const all = this.read(); const oldest = now - configuration.retentionDays * 86_400_000; const retained = all.filter(record => Date.parse(record.timestamp) >= oldest).slice(-configuration.maxRecords); if (retained.length !== all.length) { fs.mkdirSync(path.dirname(this.file()), { recursive: true }); fs.writeFileSync(this.file(), retained.map(record => JSON.stringify(record)).join(retained.length ? '\n' : '') + (retained.length ? '\n' : '')); } return all.length - retained.length; }
  private file(): string { return path.join(this.workspaceRoot, '.lgs', 'usage.jsonl'); }
}

/** Separate file keeps pricing edits independent from metrics retention and records. */
export class FilePricingStore {
  constructor(private readonly workspaceRoot: string) {}
  read(): Record<string, PricingEntry> { try { const value = JSON.parse(fs.readFileSync(this.file(), 'utf8')) as unknown; return validPricing(value) ? value : {}; } catch { return {}; } }
  update(entries: Record<string, PricingEntry>): void { fs.mkdirSync(path.dirname(this.file()), { recursive: true }); fs.writeFileSync(this.file(), JSON.stringify(entries, null, 2) + '\n'); }
  private file(): string { return path.join(this.workspaceRoot, '.lgs', 'pricing.json'); }
}

function validRecord(value: unknown): value is UsageRecord { return typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string' && typeof (value as { timestamp?: unknown }).timestamp === 'string'; }
function validPricing(value: unknown): value is Record<string, PricingEntry> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
