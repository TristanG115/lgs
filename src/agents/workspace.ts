import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentProfileDefinition, PluginDefinition } from './types.js';

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
  profiles(): AgentProfileDefinition[] { return readJsonDirectory<AgentProfileDefinition>(path.join(this.root, '.agents', 'profiles')); }
  plugins(): PluginDefinition[] { try { const value = JSON.parse(fs.readFileSync(path.join(this.root, '.agents', 'config.json'), 'utf8')) as { plugins?: PluginDefinition[] }; return Array.isArray(value.plugins) ? value.plugins : []; } catch { return []; } }
  private requiredPaths(): string[] { return [path.join(this.root, 'AGENTS.md'), path.join(this.root, '.agents', 'skills'), path.join(this.root, '.agents', 'profiles'), path.join(this.root, '.agents', 'config.json')]; }
}

export const DEFAULT_AGENT_PROFILES: AgentProfileDefinition[] = [
  profile('manager', 'Manager', 'Routes work and evaluates progress', ['inspect', 'plan', 'verify'], false, true, false, false, true),
  profile('researcher', 'Researcher', 'Collects repository and external evidence', ['inspect', 'web'], false, true, false, true, true),
  profile('planner', 'Planner', 'Produces implementation plans from evidence', ['inspect', 'plan'], false, true, false, false, true),
  profile('frontend', 'Frontend', 'Implements and verifies visible interfaces', ['inspect', 'edit', 'commands', 'verify'], true, true, true, false, true),
  profile('backend', 'Backend', 'Implements runtime and data-layer changes', ['inspect', 'edit', 'commands', 'verify'], true, true, true, false, true),
  profile('verifier', 'Verifier', 'Runs checks and validates outcomes', ['inspect', 'commands', 'verify'], false, true, true, false, true),
];
function profile(id: string, name: string, description: string, capabilities: AgentProfileDefinition['capabilities'], edit: boolean, read: boolean, commands: boolean, web: boolean, verificationRequired: boolean): AgentProfileDefinition { return { id, name, description, allowedSkills: [], preferredSkills: [], capabilities, permissions: { read, edit, commands, web }, verificationRequired }; }
function readJsonDirectory<T>(directory: string): T[] { try { return fs.readdirSync(directory).filter(file => file.endsWith('.json')).sort().flatMap(file => { try { return [JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8')) as T]; } catch { return []; } }); } catch { return []; } }
