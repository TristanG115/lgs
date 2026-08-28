import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentProfileExecutionGuard, AgentProfileStore, AgentWorkspaceService, DEFAULT_AGENT_PROFILES, SkillGenerationService } from '../src/agents/index.js';
import { WorkspaceSkillStore } from '../src/knowledge/skills.js';
import { MemoryAuditSink, ToolExecutor, ToolRegistry } from '../src/tools/framework.js';

const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lgs-agent-customization-'));
const cleanup = (root: string) => fs.rmSync(root, { recursive: true, force: true });
const permission = (access: 'read-only' | 'execute') => ({ access, scope: 'workspace' as const, network: false });

describe('agent workspace and profile policy', () => {
  it('initializes the compatible minimum without overwriting repository-owned files', () => {
    const root = fixture(); fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Keep me\n'); fs.mkdirSync(path.join(root, '.agents'), { recursive: true }); fs.writeFileSync(path.join(root, '.agents', 'config.json'), '{"existing":true}\n');
    const state = new AgentWorkspaceService(root).initialize(); expect(state.initialized).toBe(true); expect(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')).toBe('# Keep me\n'); expect(fs.readFileSync(path.join(root, '.agents', 'config.json'), 'utf8')).toBe('{"existing":true}\n'); cleanup(root);
  });

  it('keeps broad capabilities as defaults and stores built-in modifications separately', () => {
    const root = fixture(); const store = new AgentProfileStore(root); const researcher = store.list().find(item => item.id === 'researcher')!;
    expect(researcher.toolPreferences).toEqual(expect.arrayContaining(['web', 'edit', 'commands', 'verify'])); expect(researcher.policy.restrictions).toEqual({});
    const saved = store.save({ ...researcher, instructions: 'Prefer official primary sources and create reproductions.' }, true); expect(saved).toMatchObject({ origin: 'built-in', modified: true }); expect(fs.existsSync(path.join(root, 'researcher.override.json'))).toBe(true);
    expect(store.restore('researcher')).toMatchObject({ modified: false, instructions: DEFAULT_AGENT_PROFILES.find(item => item.id === 'researcher')!.instructions }); expect(fs.existsSync(path.join(root, 'researcher.override.json'))).toBe(false); cleanup(root);
  });
});

describe('skill creation, routing, import, and approval', () => {
  it('creates routing metadata and supporting resources with collision and path safety', () => {
    const root = fixture(); const store = new WorkspaceSkillStore(root); const skill = store.create({ name: 'Source Validation', description: 'Validate current claims.', instructions: 'Prefer primary sources.', routing: { profiles: ['researcher', 'verifier'], activation: 'automatic' }, supportingFiles: [{ path: 'references/checklist.md', content: '# Checklist\n' }] });
    expect(skill).toMatchObject({ id: 'source-validation', valid: true, routing: { profiles: ['researcher', 'verifier'], activation: 'automatic' } }); expect(skill.supportingFiles).toContain('.agents/skills/source-validation/references/checklist.md');
    expect(() => store.create({ name: 'Unsafe', description: 'No', instructions: 'No', supportingFiles: [{ path: '../escape.md', content: '' }] })).toThrow('Unsafe'); expect(() => store.create({ name: 'Source Validation', description: 'Duplicate', instructions: 'No' })).toThrow('already exists'); cleanup(root);
  });

  it('does not persist an interviewed skill until the reviewed proposal is approved', () => {
    const root = fixture(); const store = new WorkspaceSkillStore(root); const generation = new SkillGenerationService(); generation.start('draft');
    const draft = generation.answer('draft', { skillName: 'Focused Testing', work: 'Improve verification work.', desiredExamples: 'Create a focused reproduction before broad checks.', avoid: 'Unrelated test rewrites.', priorities: 'Fast feedback; reliable evidence.', constraints: 'Use repository test commands.', scope: 'project', profiles: ['verifier'], activation: 'automatic' });
    expect(draft.status).toBe('review'); expect(store.list()).toHaveLength(0); expect(generation.diff('draft')).toContain('+++ proposed/SKILL.md');
    expect(generation.approve('draft', store)).toMatchObject({ name: 'Focused Testing', scope: 'project' }); expect(store.list()).toHaveLength(1); cleanup(root);
  });

  it('imports a compatible local directory through the source-independent store boundary', () => {
    const root = fixture(); const source = fixture(); fs.writeFileSync(path.join(source, 'SKILL.md'), '---\nname: Imported Skill\ndescription: Local import\n---\n\nInspect evidence.\n'); const imported = new WorkspaceSkillStore(root).importDirectory(source); expect(imported).toMatchObject({ name: 'Imported Skill', source: 'local', valid: true }); cleanup(source); cleanup(root);
  });

  it('exposes malformed installed definitions without routing their instructions', () => {
    const root = fixture(); const directory = path.join(root, '.agents', 'skills', 'broken'); fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, 'SKILL.md'), '# Missing frontmatter\n'); const store = new WorkspaceSkillStore(root); expect(store.list()[0]).toMatchObject({ id: 'broken', valid: false, enabled: false }); expect(store.select('broken', 1_000)).toEqual([]); cleanup(root);
  });
});

describe('Plan Mode enforcement', () => {
  it('allows repository inspection and plan writes but rejects source and git mutation at the executor boundary', async () => {
    const root = fixture(); const registry = new ToolRegistry(); let mutations = 0;
    registry.register({ id: 'read_repository', description: 'Read', permission: permission('read-only'), argumentSchema: { type: 'object', properties: {}, additionalProperties: false }, execute: () => ({ data: 'ok' }) });
    registry.register({ id: 'create_plan_task', description: 'Plan', permission: permission('execute'), argumentSchema: { type: 'object', properties: {}, additionalProperties: false }, execute: () => { mutations += 1; return { data: 'plan' }; } });
    registry.register({ id: 'replace_file', description: 'Write', permission: permission('execute'), argumentSchema: { type: 'object', properties: {}, additionalProperties: false }, execute: () => { mutations += 100; return { data: 'write' }; } });
    registry.register({ id: 'git_commit', description: 'Commit', permission: permission('execute'), argumentSchema: { type: 'object', properties: {}, additionalProperties: false }, execute: () => { mutations += 100; return { data: 'commit' }; } });
    const audit = new MemoryAuditSink(); const executor = new ToolExecutor(registry, root, audit);
    expect((await executor.execute({ id: 'read_repository', arguments: {} }, { taskMode: 'plan' })).status).toBe('success'); expect((await executor.execute({ id: 'create_plan_task', arguments: {} }, { taskMode: 'plan' })).status).toBe('success');
    for (const id of ['replace_file', 'git_commit']) { const result = await executor.execute({ id, arguments: {} }, { taskMode: 'plan' }); expect(result.status).toBe('error'); expect(result.error?.message).toContain('Write blocked by Plan Mode'); }
    expect(mutations).toBe(1); cleanup(root);
  });

  it('enforces explicit profile restrictions outside prompt text', async () => {
    const root = fixture(); const restricted = { ...DEFAULT_AGENT_PROFILES[0], policy: { ...DEFAULT_AGENT_PROFILES[0].policy, restrictions: { code: 'deny' as const } } }; const registry = new ToolRegistry(); registry.register({ id: 'replace_file', description: 'Write', permission: permission('execute'), argumentSchema: { type: 'object', properties: {}, additionalProperties: false }, execute: () => ({ data: 'written' }) }); const executor = new ToolExecutor(registry, root, undefined, undefined, [new AgentProfileExecutionGuard(() => restricted)]); const result = await executor.execute({ id: 'replace_file', arguments: {} }, { taskMode: 'implementation', agentRole: 'manager' }); expect(result.status).toBe('error'); expect(result.error?.message).toContain('profile blocks source mutation'); cleanup(root);
  });
});
