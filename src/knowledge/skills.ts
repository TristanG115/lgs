import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse } from 'yaml';
import type { SkillMetadata, WorkspaceSkill } from './types.js';

const DEFAULT_COST = 500;

export class WorkspaceSkillStore {
  constructor(private readonly root: string) {}

  list(): WorkspaceSkill[] {
    const directory = path.join(this.root, '.lgs', 'skills');
    try {
      return fs.readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory())
        .map(entry => this.read(entry.name)).filter((skill): skill is WorkspaceSkill => Boolean(skill)).sort((a, b) => a.name.localeCompare(b.name));
    } catch { return []; }
  }

  get(name: string): WorkspaceSkill | undefined { return this.list().find(skill => skill.name === name); }

  select(query: string, maximumTokens: number): WorkspaceSkill[] {
    const terms = tokenize(query);
    let used = 0;
    return this.list().map(skill => ({ skill, score: score(skill, terms) })).filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name)).flatMap(item => {
        if (used + item.skill.estimatedTokenCost > maximumTokens) return [];
        used += item.skill.estimatedTokenCost; return [item.skill];
      });
  }

  private read(directory: string): WorkspaceSkill | undefined {
    const file = path.join(this.root, '.lgs', 'skills', directory, 'SKILL.md');
    try {
      const raw = fs.readFileSync(file, 'utf8'); const parsed = frontmatter(raw); if (!parsed) return;
      const metadata = parsed.metadata;
      if (!metadata.name || !metadata.description) return;
      const base = path.dirname(file);
      const supportingFiles = fs.readdirSync(base, { withFileTypes: true }).filter(entry => entry.isFile() && entry.name !== 'SKILL.md').map(entry => path.relative(this.root, path.join(base, entry.name)).split(path.sep).join('/')).sort();
      return { ...metadata, path: path.relative(this.root, file).split(path.sep).join('/'), supportingFiles, content: parsed.content.trim() };
    } catch { return; }
  }
}

function frontmatter(raw: string): { metadata: SkillMetadata; content: string } | undefined {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/); if (!match) return;
  const value = parse(match[1]); if (!record(value)) return;
  const name = string(value.name, 100); const description = string(value.description, 1000);
  const estimatedTokenCost = typeof value.estimatedTokenCost === 'number' && Number.isInteger(value.estimatedTokenCost) && value.estimatedTokenCost > 0 && value.estimatedTokenCost <= 20_000 ? value.estimatedTokenCost : DEFAULT_COST;
  return { metadata: { name, description, applicableTasks: strings(value.applicableTasks), activationRules: strings(value.activationRules), estimatedTokenCost }, content: match[2] };
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function string(value: unknown, maximum: number): string { return typeof value === 'string' ? value.trim().slice(0, maximum) : ''; }
function strings(value: unknown): string[] { return Array.isArray(value) ? [...new Set(value.filter(item => typeof item === 'string').map(item => item.trim().slice(0, 300)).filter(Boolean))].slice(0, 50) : []; }
function tokenize(value: string): string[] { return value.toLocaleLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? []; }
function score(skill: WorkspaceSkill, terms: string[]): number { const text = `${skill.name} ${skill.description} ${skill.applicableTasks.join(' ')} ${skill.activationRules.join(' ')}`.toLocaleLowerCase(); return terms.reduce((total, term) => total + (text.includes(term) ? 1 : 0), 0); }
