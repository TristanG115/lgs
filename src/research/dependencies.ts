import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse } from 'yaml';
import { discoverFiles } from '../intelligence/indexer.js';
import type { DependencyVersion } from './types.js';

export class DependencyCatalog {
  constructor(private readonly workspaceRoot: string) {}

  read(): DependencyVersion[] {
    const dependencies = new Map<string, DependencyVersion>();
    const files = discoverFiles(this.workspaceRoot);
    for (const file of files.filter(candidate => path.basename(candidate) === 'package.json')) this.readPackageManifest(file, dependencies);
    for (const file of files.filter(candidate => path.basename(candidate) === 'package-lock.json')) this.readPackageLock(file, dependencies);
    for (const file of files.filter(candidate => path.basename(candidate) === 'pnpm-lock.yaml')) this.readPnpmLock(file, dependencies);
    for (const file of files.filter(candidate => /^requirements.*\.txt$/i.test(path.basename(candidate)))) this.readRequirements(file, dependencies);
    return [...dependencies.values()].map(value => ({ ...value, manifestPaths: [...new Set(value.manifestPaths)].sort() })).sort((left, right) => left.name.localeCompare(right.name));
  }

  resolve(requested: string | undefined, query: string, entries = this.read()): DependencyVersion | undefined {
    if (requested) return entries.find(entry => entry.name.toLowerCase() === requested.toLowerCase());
    const normalized = query.toLowerCase();
    return [...entries].sort((left, right) => right.name.length - left.name.length).find(entry => dependencyMentioned(normalized, entry.name.toLowerCase()));
  }

  private readPackageManifest(relative: string, result: Map<string, DependencyVersion>): void {
    try {
      const value = JSON.parse(fs.readFileSync(path.join(this.workspaceRoot, relative), 'utf8')) as Record<string, unknown>;
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        const group = value[field]; if (!record(group)) continue;
        for (const [name, version] of Object.entries(group)) if (typeof version === 'string') merge(result, name, { declaredVersion: version, manifestPath: relative });
      }
    } catch { /* Malformed manifests remain visible elsewhere and do not prevent research. */ }
  }

  private readPackageLock(relative: string, result: Map<string, DependencyVersion>): void {
    try {
      const value = JSON.parse(fs.readFileSync(path.join(this.workspaceRoot, relative), 'utf8')) as Record<string, unknown>;
      if (!record(value.packages)) return;
      for (const [location, raw] of Object.entries(value.packages)) {
        if (!location.startsWith('node_modules/') || !record(raw) || typeof raw.version !== 'string') continue;
        merge(result, location.slice('node_modules/'.length), { resolvedVersion: raw.version, manifestPath: relative });
      }
    } catch { /* Ignore malformed lockfiles safely. */ }
  }

  private readPnpmLock(relative: string, result: Map<string, DependencyVersion>): void {
    try {
      const value = parse(fs.readFileSync(path.join(this.workspaceRoot, relative), 'utf8')) as unknown;
      if (!record(value) || !record(value.packages)) return;
      for (const key of Object.keys(value.packages)) {
        const match = key.match(/^\/?(@[^/]+\/[^@/]+|[^@/]+)@([^()]+)$/);
        if (match) merge(result, match[1], { resolvedVersion: match[2], manifestPath: relative });
      }
    } catch { /* Ignore malformed lockfiles safely. */ }
  }

  private readRequirements(relative: string, result: Map<string, DependencyVersion>): void {
    try {
      for (const line of fs.readFileSync(path.join(this.workspaceRoot, relative), 'utf8').split(/\r?\n/)) {
        const match = line.trim().match(/^([A-Za-z0-9_.-]+)==([^\s;]+)/);
        if (match) merge(result, match[1], { declaredVersion: `==${match[2]}`, resolvedVersion: match[2], manifestPath: relative });
      }
    } catch { /* Ignore unreadable requirements files safely. */ }
  }
}

function merge(result: Map<string, DependencyVersion>, name: string, values: { declaredVersion?: string; resolvedVersion?: string; manifestPath: string }): void {
  const current = result.get(name) ?? { name, manifestPaths: [] };
  if (values.declaredVersion) current.declaredVersion = values.declaredVersion;
  if (values.resolvedVersion) current.resolvedVersion = values.resolvedVersion;
  current.manifestPaths.push(values.manifestPath); result.set(name, current);
}
function dependencyMentioned(query: string, name: string): boolean { const index = query.indexOf(name); return index >= 0 && !/[a-z0-9@/_-]/.test(query[index - 1] ?? '') && !/[a-z0-9@/_-]/.test(query[index + name.length] ?? ''); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
