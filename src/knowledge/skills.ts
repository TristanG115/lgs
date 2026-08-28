import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse } from 'yaml';
import type { SkillMetadata, WorkspaceSkill } from './types.js';

const DEFAULT_COST = 500;

export class WorkspaceSkillStore {
  constructor(private readonly root: string, private readonly globalRoot?: string) {}

  list(): WorkspaceSkill[] {
    const locations = [{ directory: path.join(this.root, '.agents', 'skills'), scope: 'project' as const }, { directory: path.join(this.root, '.lgs', 'skills'), scope: 'project' as const }, ...(this.globalRoot ? [{ directory: this.globalRoot, scope: 'global' as const }] : [])];
    const seen = new Set<string>(); const values: WorkspaceSkill[] = [];
    for (const location of locations) try {
      for (const entry of fs.readdirSync(location.directory, { withFileTypes: true }).filter(item => item.isDirectory())) {
        const skill = this.read(location.directory, entry.name, location.scope); if (!skill || seen.has(`${skill.scope}:${skill.name}`)) continue; seen.add(`${skill.scope}:${skill.name}`); values.push(skill);
      }
    } catch { /* absent skill roots are valid */ }
    return values.sort((a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope));
  }

  get(name: string): WorkspaceSkill | undefined { return this.list().find(skill => skill.name === name); }

  select(query: string, maximumTokens: number): WorkspaceSkill[] {
    const terms = tokenize(query);
    let used = 0;
    return this.list().filter(skill => skill.enabled).map(skill => ({ skill, score: score(skill, terms) })).filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name)).flatMap(item => {
        if (used + item.skill.estimatedTokenCost > maximumTokens) return [];
        used += item.skill.estimatedTokenCost; return [item.skill];
      });
  }

  create(input: { name: string; description: string; instructions: string; scope?: 'project' | 'global' }): WorkspaceSkill {
    const slug = skillSlug(input.name); if (!slug) throw new Error('Skill name must contain letters or numbers.');
    const baseRoot = input.scope === 'global' ? this.globalRoot : path.join(this.root, '.agents', 'skills'); if (!baseRoot) throw new Error('Global skill storage is not configured.');
    const directory = path.join(baseRoot, slug); if (fs.existsSync(directory)) throw new Error(`Skill already exists: ${slug}`);
    if (!input.description.trim() || !input.instructions.trim()) throw new Error('Skill purpose and instructions are required.');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'SKILL.md'), `---\nname: ${yamlScalar(input.name.trim())}\ndescription: ${yamlScalar(input.description.trim())}\napplicableTasks: []\nactivationRules: []\nestimatedTokenCost: 500\nenabled: true\nsource: manual\n---\n\n${input.instructions.trim()}\n`, { encoding: 'utf8', flag: 'wx' });
    const skill = this.read(baseRoot, slug, input.scope || 'project'); if (!skill) throw new Error('Generated skill failed validation.'); return skill;
  }

  setEnabled(name: string, enabled: boolean, scope: 'project' | 'global' = 'project'): WorkspaceSkill {
    const skill = this.list().find(item => item.name === name && item.scope === scope); if (!skill) throw new Error('Skill not found.');
    const file = path.isAbsolute(skill.path) ? skill.path : path.join(this.root, skill.path); const raw = fs.readFileSync(file, 'utf8');
    const updated = /\nenabled:\s*(?:true|false)\s*\n/.test(raw) ? raw.replace(/\nenabled:\s*(?:true|false)\s*\n/, `\nenabled: ${enabled}\n`) : raw.replace(/^---\r?\n/, `---\nenabled: ${enabled}\n`);
    fs.writeFileSync(file, updated, 'utf8'); return { ...skill, enabled };
  }

  private read(root: string, directory: string, scope: 'global' | 'project'): WorkspaceSkill | undefined {
    const file = path.join(root, directory, 'SKILL.md');
    try {
      const raw = fs.readFileSync(file, 'utf8'); const parsed = frontmatter(raw); if (!parsed) return;
      const metadata = parsed.metadata;
      if (!metadata.name || !metadata.description) return;
      const base = path.dirname(file);
      const supportingFiles = fs.readdirSync(base, { withFileTypes: true }).filter(entry => entry.isFile() && entry.name !== 'SKILL.md').map(entry => scope === 'project' ? path.relative(this.root, path.join(base, entry.name)).split(path.sep).join('/') : path.join(base, entry.name)).sort();
      return { ...metadata, scope, enabled: metadata.enabled !== false, source: metadata.source || 'local', path: scope === 'project' ? path.relative(this.root, file).split(path.sep).join('/') : file, supportingFiles, content: parsed.content.trim() };
    } catch { return; }
  }
}

function frontmatter(raw: string): { metadata: SkillMetadata; content: string } | undefined {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/); if (!match) return;
  const value = parse(match[1]); if (!record(value)) return;
  const name = string(value.name, 100); const description = string(value.description, 1000);
  const estimatedTokenCost = typeof value.estimatedTokenCost === 'number' && Number.isInteger(value.estimatedTokenCost) && value.estimatedTokenCost > 0 && value.estimatedTokenCost <= 20_000 ? value.estimatedTokenCost : DEFAULT_COST;
  return { metadata: { name, description, applicableTasks: strings(value.applicableTasks), activationRules: strings(value.activationRules), estimatedTokenCost, enabled: value.enabled !== false, source: string(value.source, 100) || 'local', compatibility: strings(value.compatibility) }, content: match[2] };
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function string(value: unknown, maximum: number): string { return typeof value === 'string' ? value.trim().slice(0, maximum) : ''; }
function strings(value: unknown): string[] { return Array.isArray(value) ? [...new Set(value.filter(item => typeof item === 'string').map(item => item.trim().slice(0, 300)).filter(Boolean))].slice(0, 50) : []; }
function tokenize(value: string): string[] { return value.toLocaleLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? []; }
function score(skill: WorkspaceSkill, terms: string[]): number { const text = `${skill.name} ${skill.description} ${skill.applicableTasks.join(' ')} ${skill.activationRules.join(' ')}`.toLocaleLowerCase(); return terms.reduce((total, term) => total + (text.includes(term) ? 1 : 0), 0); }
function skillSlug(value: string): string { return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80); }
function yamlScalar(value: string): string { return JSON.stringify(value); }
