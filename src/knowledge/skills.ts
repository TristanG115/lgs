import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse } from 'yaml';
import type { SkillCreateInput, SkillMetadata, WorkspaceSkill } from './types.js';

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
    return this.list().filter(skill => skill.enabled && skill.valid).map(skill => ({ skill, score: score(skill, terms) })).filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name)).flatMap(item => {
        if (used + item.skill.estimatedTokenCost > maximumTokens) return [];
        used += item.skill.estimatedTokenCost; return [item.skill];
      });
  }

  create(input: SkillCreateInput): WorkspaceSkill {
    const slug = skillSlug(input.name); if (!slug) throw new Error('Skill name must contain letters or numbers.');
    const baseRoot = input.scope === 'global' ? this.globalRoot : path.join(this.root, '.agents', 'skills'); if (!baseRoot) throw new Error('Global skill storage is not configured.');
    const directory = path.join(baseRoot, slug); if (fs.existsSync(directory)) throw new Error(`Skill already exists: ${slug}`);
    if (!input.description.trim() || !input.instructions.trim()) throw new Error('Skill purpose and instructions are required.');
    const resources = input.supportingFiles || []; for (const resource of resources) validateResource(resource.path);
    fs.mkdirSync(directory, { recursive: true });
    const routing = input.routing || { profiles: [], activation: 'automatic' as const };
    fs.writeFileSync(path.join(directory, 'SKILL.md'), `---\nname: ${yamlScalar(input.name.trim())}\ndescription: ${yamlScalar(input.description.trim())}\napplicableTasks: []\nactivationRules: []\nestimatedTokenCost: 500\nenabled: true\nsource: manual\nrouting:\n  profiles: ${JSON.stringify(routing.profiles)}\n  activation: ${routing.activation}\n---\n\n${input.instructions.trim()}\n`, { encoding: 'utf8', flag: 'wx' });
    for (const resource of resources) { const target = path.join(directory, resource.path); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, resource.content, { encoding: 'utf8', flag: 'wx' }); }
    const skill = this.read(baseRoot, slug, input.scope || 'project'); if (!skill) throw new Error('Generated skill failed validation.'); return skill;
  }

  importDirectory(sourceDirectory: string, scope: 'project' | 'global' = 'project'): WorkspaceSkill {
    const source = path.resolve(sourceDirectory); const sourceFile = path.join(source, 'SKILL.md'); if (!fs.statSync(source).isDirectory() || !fs.existsSync(sourceFile)) throw new Error('Imported skill must be a directory containing SKILL.md.');
    const parsed = this.parseFile(sourceFile); if (!parsed.metadata.name || !parsed.metadata.description) throw new Error('Imported skill metadata is malformed.');
    const slug = skillSlug(parsed.metadata.name); const baseRoot = scope === 'global' ? this.globalRoot : path.join(this.root, '.agents', 'skills'); if (!baseRoot) throw new Error('Global skill storage is not configured.');
    const destination = path.join(baseRoot, slug); if (fs.existsSync(destination)) throw new Error(`Skill already exists: ${slug}`);
    validateImportTree(source); fs.mkdirSync(baseRoot, { recursive: true }); copySkillDirectory(source, destination); const skill = this.read(baseRoot, slug, scope); if (!skill) throw new Error('Imported skill failed validation.'); return skill;
  }

  validate(name: string, scope: 'project' | 'global' = 'project'): { valid: boolean; errors: string[] } {
    const skill = this.list().find(item => item.name === name && item.scope === scope); return skill ? { valid: skill.valid, errors: skill.validationErrors } : { valid: false, errors: ['Skill not found.'] };
  }

  setEnabled(name: string, enabled: boolean, scope: 'project' | 'global' = 'project'): WorkspaceSkill {
    const skill = this.list().find(item => item.name === name && item.scope === scope); if (!skill) throw new Error('Skill not found.'); if (!skill.valid) throw new Error('Malformed skills must be repaired before they can be enabled or disabled.');
    const file = path.isAbsolute(skill.path) ? skill.path : path.join(this.root, skill.path); const raw = fs.readFileSync(file, 'utf8');
    const updated = /\nenabled:\s*(?:true|false)\s*\n/.test(raw) ? raw.replace(/\nenabled:\s*(?:true|false)\s*\n/, `\nenabled: ${enabled}\n`) : raw.replace(/^---\r?\n/, `---\nenabled: ${enabled}\n`);
    fs.writeFileSync(file, updated, 'utf8'); return { ...skill, enabled };
  }

  updateInstructions(name: string, scope: 'project' | 'global', description: string, instructions: string, routing?: SkillMetadata['routing']): WorkspaceSkill {
    const skill = this.list().find(item => item.name === name && item.scope === scope); if (!skill) throw new Error('Skill not found.');
    if (!description.trim() || !instructions.trim()) throw new Error('Skill purpose and instructions are required.');
    const file = path.isAbsolute(skill.path) ? skill.path : path.join(this.root, skill.path); const raw = fs.readFileSync(file, 'utf8'); const parsed = frontmatter(raw); if (!parsed) throw new Error('Existing SKILL.md is malformed.');
    const metadata = { ...parsed.metadata, description: description.trim(), routing: routing || parsed.metadata.routing };
    fs.writeFileSync(file, renderSkill(metadata, instructions));
    const base = scope === 'global' ? this.globalRoot! : path.join(this.root, '.agents', 'skills'); const updated = this.read(base, skill.id, scope); if (!updated) throw new Error('Updated skill failed validation.'); return updated;
  }

  private read(root: string, directory: string, scope: 'global' | 'project'): WorkspaceSkill | undefined {
    const file = path.join(root, directory, 'SKILL.md');
    try {
      const raw = fs.readFileSync(file, 'utf8'); const parsed = frontmatter(raw); if (!parsed) return invalidSkill(directory, file, scope, 'SKILL.md requires valid YAML frontmatter.');
      const metadata = parsed.metadata;
      const base = path.dirname(file);
      const supportingFiles = resourceFiles(base).filter(candidate => path.basename(candidate) !== 'SKILL.md').map(candidate => scope === 'project' ? path.relative(this.root, candidate).split(path.sep).join('/') : candidate).sort();
      const errors = validateMetadata(metadata, parsed.content);
      return { ...metadata, id: directory, scope, enabled: metadata.enabled !== false, source: metadata.source || 'local', path: scope === 'project' ? path.relative(this.root, file).split(path.sep).join('/') : file, supportingFiles, content: parsed.content.trim(), valid: errors.length === 0, validationErrors: errors };
    } catch { return; }
  }

  private parseFile(file: string): { metadata: SkillMetadata; content: string } { const parsed = frontmatter(fs.readFileSync(file, 'utf8')); if (!parsed) throw new Error('SKILL.md requires valid YAML frontmatter.'); return parsed; }
}

function frontmatter(raw: string): { metadata: SkillMetadata; content: string } | undefined {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/); if (!match) return;
  const value = parse(match[1]); if (!record(value)) return;
  const name = string(value.name, 100); const description = string(value.description, 1000);
  const estimatedTokenCost = typeof value.estimatedTokenCost === 'number' && Number.isInteger(value.estimatedTokenCost) && value.estimatedTokenCost > 0 && value.estimatedTokenCost <= 20_000 ? value.estimatedTokenCost : DEFAULT_COST;
  const routingValue = record(value.routing) ? value.routing : {};
  const activation = routingValue.activation === 'manual' ? 'manual' : 'automatic';
  return { metadata: { name, description, applicableTasks: strings(value.applicableTasks), activationRules: strings(value.activationRules), estimatedTokenCost, enabled: value.enabled !== false, source: string(value.source, 100) || 'local', compatibility: strings(value.compatibility), routing: { profiles: strings(routingValue.profiles), activation } }, content: match[2] };
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function string(value: unknown, maximum: number): string { return typeof value === 'string' ? value.trim().slice(0, maximum) : ''; }
function strings(value: unknown): string[] { return Array.isArray(value) ? [...new Set(value.filter(item => typeof item === 'string').map(item => item.trim().slice(0, 300)).filter(Boolean))].slice(0, 50) : []; }
function tokenize(value: string): string[] { return value.toLocaleLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? []; }
function score(skill: WorkspaceSkill, terms: string[]): number { const text = `${skill.name} ${skill.description} ${skill.applicableTasks.join(' ')} ${skill.activationRules.join(' ')}`.toLocaleLowerCase(); return terms.reduce((total, term) => total + (text.includes(term) ? 1 : 0), 0); }
function skillSlug(value: string): string { return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80); }
function yamlScalar(value: string): string { return JSON.stringify(value); }
function renderSkill(value: SkillMetadata, instructions: string): string { const routing = value.routing || { profiles: [], activation: 'automatic' as const }; return `---\nname: ${yamlScalar(value.name)}\ndescription: ${yamlScalar(value.description)}\napplicableTasks: ${JSON.stringify(value.applicableTasks)}\nactivationRules: ${JSON.stringify(value.activationRules)}\nestimatedTokenCost: ${value.estimatedTokenCost}\nenabled: ${value.enabled !== false}\nsource: ${yamlScalar(value.source || 'manual')}\ncompatibility: ${JSON.stringify(value.compatibility || [])}\nrouting:\n  profiles: ${JSON.stringify(routing.profiles)}\n  activation: ${routing.activation}\n---\n\n${instructions.trim()}\n`; }
function validateMetadata(metadata: SkillMetadata, content: string): string[] { const errors: string[] = []; if (!metadata.name) errors.push('Missing skill name.'); if (!metadata.description) errors.push('Missing skill description.'); if (!content.trim()) errors.push('Skill instructions are empty.'); return errors; }
function validateResource(value: string): void { const normalized = value.replace(/\\/g, '/'); if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..') || normalized === 'SKILL.md') throw new Error(`Unsafe supporting resource path: ${value}`); }
function copySkillDirectory(source: string, destination: string): void { fs.mkdirSync(destination, { recursive: false }); for (const entry of fs.readdirSync(source, { withFileTypes: true })) { if (entry.isSymbolicLink()) throw new Error('Skill imports cannot contain symbolic links.'); const from = path.join(source, entry.name); const to = path.join(destination, entry.name); if (entry.isDirectory()) copySkillDirectory(from, to); else if (entry.isFile()) fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL); } }
function validateImportTree(directory: string): void { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { if (entry.isSymbolicLink()) throw new Error('Skill imports cannot contain symbolic links.'); if (entry.isDirectory()) validateImportTree(path.join(directory, entry.name)); } }
function resourceFiles(directory: string): string[] { return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isSymbolicLink() ? [] : entry.isDirectory() ? resourceFiles(path.join(directory, entry.name)) : entry.isFile() ? [path.join(directory, entry.name)] : []); }
function invalidSkill(directory: string, file: string, scope: 'global' | 'project', error: string): WorkspaceSkill { return { id: directory, name: directory, description: 'Malformed skill definition', applicableTasks: [], activationRules: [], estimatedTokenCost: DEFAULT_COST, scope, enabled: false, source: 'local', path: file, supportingFiles: [], content: '', valid: false, validationErrors: [error] }; }
