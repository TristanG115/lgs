import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentProfileDefinition, AgentProfileDraft, AgentProfilePolicy, PluginDefinition } from './types.js';

export type AgentWorkspaceState = { initialized: boolean; agentsFile: boolean; skillsDirectory: boolean; profilesDirectory: boolean; configFile: boolean };

export class AgentWorkspaceService {
  constructor(private readonly root: string) {}
  state(): AgentWorkspaceState { return { initialized: this.requiredPaths().every(item => fs.existsSync(item)), agentsFile: fs.existsSync(path.join(this.root, 'AGENTS.md')), skillsDirectory: fs.existsSync(path.join(this.root, '.agents', 'skills')), profilesDirectory: fs.existsSync(path.join(this.root, '.agents', 'profiles')), configFile: fs.existsSync(path.join(this.root, '.agents', 'config.json')) }; }
  initialize(): AgentWorkspaceState {
    const agents = path.join(this.root, 'AGENTS.md'); const skills = path.join(this.root, '.agents', 'skills'); const profiles = path.join(this.root, '.agents', 'profiles'); const config = path.join(this.root, '.agents', 'config.json');
    fs.mkdirSync(skills, { recursive: true }); fs.mkdirSync(profiles, { recursive: true });
    if (!fs.existsSync(agents)) fs.writeFileSync(agents, '# Agent instructions\n\nAdd repository-specific agent guidance here.\n', { encoding: 'utf8', flag: 'wx' });
    if (!fs.existsSync(config)) fs.writeFileSync(config, JSON.stringify({ version: 1, automaticManagement: false, enabledSkills: [], plugins: [] }, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    return this.state();
  }
  profiles(): AgentProfileDefinition[] { return new AgentProfileStore(path.join(this.root, '.agents', 'profiles')).list(); }
  plugins(): PluginDefinition[] { try { const value = JSON.parse(fs.readFileSync(path.join(this.root, '.agents', 'config.json'), 'utf8')) as { plugins?: PluginDefinition[] }; return Array.isArray(value.plugins) ? value.plugins : []; } catch { return []; } }
  private requiredPaths(): string[] { return [path.join(this.root, 'AGENTS.md'), path.join(this.root, '.agents', 'skills'), path.join(this.root, '.agents', 'profiles'), path.join(this.root, '.agents', 'config.json')]; }
}

export class AgentProfileStore {
  constructor(private readonly customizationRoot: string) {}
  list(): AgentProfileDefinition[] {
    const custom = readJsonDirectory<unknown>(this.customizationRoot); const overrides = new Map(custom.filter(isOverride).map(item => [item.id, item.profile]));
    const users = custom.filter(isProfile).map(item => normalizeProfile(item, 'user', false));
    return [...DEFAULT_AGENT_PROFILES.map(item => overrides.has(item.id) ? mergeProfile(item, overrides.get(item.id)!) : item), ...users.filter(item => !DEFAULT_AGENT_PROFILES.some(value => value.id === item.id))]
      .sort((a, b) => Number(a.origin === 'user') - Number(b.origin === 'user') || a.name.localeCompare(b.name));
  }
  save(profile: AgentProfileDraft, builtIn = DEFAULT_AGENT_PROFILES.some(item => item.id === profile.id), replaceUser = false): AgentProfileDefinition {
    validateProfile(profile); fs.mkdirSync(this.customizationRoot, { recursive: true });
    if (builtIn) { const original = DEFAULT_AGENT_PROFILES.find(item => item.id === profile.id); if (!original) throw new Error('Built-in profile not found.'); const normalized = normalizeProfile(profile, 'built-in', true); const changes = difference(original, normalized); fs.writeFileSync(this.overrideFile(profile.id), JSON.stringify({ kind: 'override', id: profile.id, profile: changes }, null, 2) + '\n'); return mergeProfile(original, changes); }
    if (DEFAULT_AGENT_PROFILES.some(item => item.id === profile.id)) throw new Error('User profile ID collides with a built-in profile.');
    const normalized = normalizeProfile(profile, 'user', false); fs.writeFileSync(this.userFile(profile.id), JSON.stringify(normalized, null, 2) + '\n', { flag: replaceUser ? 'w' : 'wx' }); return normalized;
  }
  restore(id: string): AgentProfileDefinition { const original = DEFAULT_AGENT_PROFILES.find(item => item.id === id); if (!original) throw new Error('Only built-in profiles can be restored.'); try { fs.unlinkSync(this.overrideFile(id)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } return original; }
  private overrideFile(id: string): string { return path.join(this.customizationRoot, `${safeId(id)}.override.json`); }
  private userFile(id: string): string { return path.join(this.customizationRoot, `${safeId(id)}.profile.json`); }
}

const sharedPreferences = ['Prefer small focused edits.', 'Use current official documentation when facts are version-sensitive.', 'Run relevant verification after implementation.'];
const basePolicy = (skills: string[], tools: AgentProfileDefinition['toolPreferences'], requirements: string[] = ['Verify the requested outcome before completion.']): AgentProfilePolicy => ({ preferences: sharedPreferences, defaults: { skills, research: 'prefer-current-sources', tools }, requirements, restrictions: {} });
export const DEFAULT_AGENT_PROFILES: AgentProfileDefinition[] = [
  profile('manager', 'Manager', 'Coordinates work and evaluates progress.', 'Emphasize outcome ownership, delegation, and evidence.', [], ['inspect', 'plan', 'web', 'verify'], 'balanced'),
  profile('researcher', 'Researcher', 'Collects repository and external evidence.', 'Emphasize primary sources, reproducible findings, and explicit uncertainty.', [], ['inspect', 'edit', 'commands', 'web', 'verify'], 'balanced', ['Cite sources during formal research.']),
  profile('planner', 'Planner', 'Produces implementation plans from evidence.', 'Emphasize architecture, risks, acceptance criteria, and a viable verification strategy.', [], ['inspect', 'plan', 'web'], 'conservative'),
  profile('frontend', 'Frontend', 'Implements and verifies visible interfaces.', 'Emphasize rendered behavior, accessibility, responsive layout, and product consistency.', [], ['inspect', 'edit', 'commands', 'web', 'verify'], 'balanced'),
  profile('backend', 'Backend', 'Implements runtime and data-layer changes.', 'Emphasize durable contracts, failure handling, security boundaries, and tests.', [], ['inspect', 'edit', 'commands', 'web', 'verify'], 'balanced'),
  profile('verifier', 'Verifier', 'Validates outcomes and creates reproductions.', 'Emphasize independent evidence, edge cases, and actionable failures.', [], ['inspect', 'edit', 'commands', 'web', 'verify'], 'conservative'),
];
function profile(id: string, name: string, description: string, instructions: string, skills: string[], tools: AgentProfileDefinition['toolPreferences'], executionBehavior: AgentProfileDefinition['executionBehavior'], extraRequirements: string[] = []): AgentProfileDefinition { const requirements = ['Verify the requested outcome before completion.', ...extraRequirements]; return { id, name, description, origin: 'built-in', modified: false, instructions, preferredSkills: skills, autoLoadedSkills: [], toolPreferences: tools, researchBehavior: 'prefer-current-sources', executionBehavior, verificationExpectations: requirements, policy: basePolicy(skills, tools, requirements) }; }
function normalizeProfile(value: AgentProfileDraft | AgentProfileDefinition, origin: AgentProfileDefinition['origin'], modified: boolean): AgentProfileDefinition { const legacy = value as unknown as Record<string, unknown>; const allowedTools = new Set(['inspect', 'plan', 'edit', 'commands', 'web', 'verify', 'iterate']); const tools = values(value.toolPreferences || legacy.capabilities).filter(item => allowedTools.has(item)); const skills = values(value.preferredSkills || legacy.allowedSkills); const expectations = values(value.verificationExpectations || (legacy.verificationRequired === false ? [] : ['Verify the requested outcome before completion.'])); const incoming = value.policy || {}; const researchBehavior = ['available', 'prefer-current-sources', 'required-for-changing-facts'].includes(String(value.researchBehavior)) ? value.researchBehavior : 'prefer-current-sources'; const executionBehavior = ['conservative', 'balanced', 'autonomous'].includes(String(value.executionBehavior)) ? value.executionBehavior : 'balanced'; return { id: safeId(value.id), name: text(value.name, 100), description: text(value.description, 500), origin, modified, instructions: text(value.instructions || value.description, 8_000), preferredSkills: skills, autoLoadedSkills: values(value.autoLoadedSkills), providerId: optional(value.providerId, 100), model: optional(value.model, 200), reasoning: ['low', 'medium', 'high'].includes(String(value.reasoning)) ? value.reasoning : undefined, toolPreferences: tools as AgentProfileDefinition['toolPreferences'], researchBehavior, executionBehavior, verificationExpectations: expectations, policy: { preferences: values(incoming.preferences || []), defaults: { reasoning: incoming.defaults?.reasoning, skills: values(incoming.defaults?.skills || skills), research: incoming.defaults?.research || researchBehavior, tools: values(incoming.defaults?.tools || tools).filter(item => allowedTools.has(item)) as AgentProfileDefinition['toolPreferences'] }, requirements: values(incoming.requirements || expectations), restrictions: incoming.restrictions || {} } }; }
function mergeProfile(base: AgentProfileDefinition, override: Partial<AgentProfileDefinition>): AgentProfileDefinition { return normalizeProfile({ ...base, ...override, policy: { ...base.policy, ...(override.policy || {}), defaults: { ...base.policy.defaults, ...(override.policy?.defaults || {}) }, restrictions: { ...base.policy.restrictions, ...(override.policy?.restrictions || {}) } } }, 'built-in', true); }
function difference(base: AgentProfileDefinition, current: AgentProfileDefinition): Partial<AgentProfileDefinition> { const output: Record<string, unknown> = {}; for (const [key, value] of Object.entries(current)) if (!['origin', 'modified'].includes(key) && JSON.stringify(value) !== JSON.stringify(base[key as keyof AgentProfileDefinition])) output[key] = value; return output as Partial<AgentProfileDefinition>; }
function validateProfile(value: AgentProfileDraft): void { if (!/^[a-z][a-z0-9-]{0,79}$/.test(value.id)) throw new Error('Profile ID must use lowercase letters, numbers, and hyphens.'); if (!value.name.trim() || !value.description.trim() || !value.instructions.trim()) throw new Error('Profile name, description, and instructions are required.'); if (!['available', 'prefer-current-sources', 'required-for-changing-facts'].includes(value.researchBehavior) || !['conservative', 'balanced', 'autonomous'].includes(value.executionBehavior)) throw new Error('Profile behavior is invalid.'); }
function safeId(value: string): string { if (!/^[a-z][a-z0-9-]{0,79}$/.test(value)) throw new Error('Profile ID is invalid.'); return value; }
function text(value: string, maximum: number): string { return String(value || '').trim().slice(0, maximum); }
function optional(value: string | undefined, maximum: number): string | undefined { const result = text(value || '', maximum); return result || undefined; }
function values(value: unknown): string[] { return Array.isArray(value) ? [...new Set(value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean))].slice(0, 100) : []; }
function readJsonDirectory<T>(directory: string): T[] { try { return fs.readdirSync(directory).filter(file => file.endsWith('.json')).sort().flatMap(file => { try { return [JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8')) as T]; } catch { return []; } }); } catch { return []; } }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isOverride(value: unknown): value is { kind: 'override'; id: string; profile: Partial<AgentProfileDefinition> } { return record(value) && value.kind === 'override' && typeof value.id === 'string' && record(value.profile); }
function isProfile(value: unknown): value is AgentProfileDefinition { return record(value) && typeof value.id === 'string' && typeof value.name === 'string' && value.kind !== 'override'; }
