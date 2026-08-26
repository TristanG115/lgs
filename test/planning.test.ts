import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileTaskStateStore, ToolExecutor, ToolRegistry, registerPlanningTools } from '../src/tools/index.js';

describe('Planning Mode', () => {
  it('blocks mutating tools while allowing approved plan handoff', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lgs-plan-')); const registry = new ToolRegistry();
    registry.register({ id: 'write_file', description: 'mutates', permission: { access: 'execute', scope: 'workspace', network: false, category: 'process' }, argumentSchema: { type: 'object', properties: {}, additionalProperties: false }, execute: () => ({ data: {}, resultCount: 1 }) });
    registerPlanningTools(registry, new FileTaskStateStore(root)); const executor = new ToolExecutor(registry, root);
    expect((await executor.execute({ id: 'write_file', arguments: {} }, { taskMode: 'planning' })).error?.message).toContain('disabled');
    const result = await executor.execute({ id: 'create_plan_task', arguments: { taskId: 'plan-18', objective: 'Plan safely.', acceptanceCriteria: ['No writes'], subtasks: ['Inspect'] } }, { taskMode: 'planning' });
    expect(result.status).toBe('success'); expect(new FileTaskStateStore(root).read('plan-18')).toMatchObject({ currentPlan: ['Inspect'] }); fs.rmSync(root, { recursive: true, force: true });
  });
});
