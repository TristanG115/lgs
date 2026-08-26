import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ProjectMemoryStore, WorkspaceSkillStore } from '../src/tools/index.js';

function fixture(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'lgs-knowledge-')); }
function cleanup(root: string): void { fs.rmSync(root, { recursive: true, force: true }); }

describe('workspace skills and durable memory', () => {
  it('loads frontmatter skills and selects only relevant skills within budget', () => {
    const root = fixture(); const directory = path.join(root, '.lgs', 'skills', 'testing'); fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'SKILL.md'), '---\nname: testing\ndescription: Test TypeScript changes\napplicableTasks: [testing, verification]\nactivationRules: [when tests change]\nestimatedTokenCost: 120\n---\nRun focused tests first.\n');
    fs.writeFileSync(path.join(directory, 'notes.md'), 'supporting guidance\n');
    const skills = new WorkspaceSkillStore(root); expect(skills.get('testing')).toMatchObject({ supportingFiles: ['.lgs/skills/testing/notes.md'] });
    expect(skills.select('verify TypeScript tests', 119)).toEqual([]); expect(skills.select('verify TypeScript tests', 120).map(skill => skill.name)).toEqual(['testing']); cleanup(root);
  });

  it('persists durable knowledge separately and retrieves it within budget', () => {
    const root = fixture(); const memories = new ProjectMemoryStore(root, { enabled: true, retentionDays: 30, maxEntries: 10, maxRetrievedTokens: 50 });
    const saved = memories.remember({ kind: 'project-convention', content: 'Use argument arrays for command execution.', tags: ['commands'] });
    expect(memories.search('command execution', 50)).toMatchObject([{ id: saved.id }]); expect(memories.inspect()).toMatchObject({ count: 1, enabled: true }); expect(memories.delete(saved.id)).toBe(true); expect(memories.inspect().count).toBe(0); cleanup(root);
  });
});
