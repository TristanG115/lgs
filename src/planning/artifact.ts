import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FileTaskStateStore } from '../watchdog/state.js';
import type { PlanHandoff, PlanningArtifact, PlanRevision, PlanSection } from './types.js';

/** Owns the durable plan record and renders PLAN.md from it. Historical revisions are append-only. */
export class PlanningArtifactStore {
  constructor(private readonly workspaceRoot: string, private readonly tasks?: FileTaskStateStore, private readonly planDirectory = '.lgs/tasks') { validatePlanDirectory(planDirectory); }

  create(taskId: string, plan: PlanSection, handoff: PlanHandoff): PlanningArtifact {
    validateTaskId(taskId);
    if (this.read(taskId)) throw new Error('A planning artifact already exists for this task. Regenerate or revise it explicitly.');
    const now = new Date().toISOString();
    const artifact: PlanningArtifact = { taskId, ...normalizePlan(plan), handoff, status: 'draft', revisions: [], createdAt: now, updatedAt: now };
    this.write(artifact); this.syncTask(artifact); return clone(artifact);
  }

  regenerate(taskId: string, plan: PlanSection, reason: string, evidence: string[] = []): PlanningArtifact {
    const current = this.require(taskId); const revision = revisionOf(current, 'Plan regenerated', reason, evidence);
    const artifact: PlanningArtifact = { ...current, ...normalizePlan(plan), status: 'draft', revisions: [...current.revisions, revision], updatedAt: revision.createdAt };
    this.write(artifact); this.syncTask(artifact); return clone(artifact);
  }

  revise(taskId: string, change: string, reason: string, evidence: string[]): PlanningArtifact {
    const current = this.require(taskId); const revision = revisionOf(current, change, reason, evidence);
    const artifact = { ...current, revisions: [...current.revisions, revision], updatedAt: revision.createdAt };
    this.write(artifact); return clone(artifact);
  }

  approve(taskId: string): PlanningArtifact {
    const current = this.require(taskId); const artifact = { ...current, status: 'approved' as const, updatedAt: new Date().toISOString() };
    this.write(artifact); return clone(artifact);
  }

  read(taskId: string): PlanningArtifact | undefined {
    if (!validTaskId(taskId)) return;
    try { const value = JSON.parse(fs.readFileSync(this.jsonFile(taskId), 'utf8')) as unknown; return validArtifact(value) ? clone(value) : undefined; }
    catch { return; }
  }

  markdown(taskId: string): string | undefined { const value = this.read(taskId); return value ? renderPlan(value) : undefined; }
  private require(taskId: string): PlanningArtifact { const value = this.read(taskId); if (!value) throw new Error('Planning artifact was not found.'); return value; }
  private jsonFile(taskId: string): string { return path.join(this.workspaceRoot, this.planDirectory, taskId, 'plan.json'); }
  private markdownFile(taskId: string): string { return path.join(this.workspaceRoot, this.planDirectory, taskId, 'PLAN.md'); }
  private write(value: PlanningArtifact): void {
    const json = this.jsonFile(value.taskId); fs.mkdirSync(path.dirname(json), { recursive: true });
    fs.writeFileSync(json, JSON.stringify(value, null, 2) + '\n'); fs.writeFileSync(this.markdownFile(value.taskId), renderPlan(value));
  }
  private syncTask(value: PlanningArtifact): void {
    if (!this.tasks) return;
    this.tasks.ensure(value.taskId, value.objective);
    this.tasks.update(value.taskId, { acceptanceCriteria: value.acceptanceCriteria, currentPlan: value.implementationStages, remainingWork: value.implementationStages });
  }
}

function normalizePlan(value: PlanSection): PlanSection {
  return { objective: bounded(value.objective, 4_000), acceptanceCriteria: list(value.acceptanceCriteria), currentUnderstanding: list(value.currentUnderstanding), approach: list(value.approach), expectedAreas: list(value.expectedAreas), implementationStages: list(value.implementationStages), verificationPlan: list(value.verificationPlan), risks: list(value.risks), openQuestions: list(value.openQuestions) };
}
function revisionOf(current: PlanningArtifact, changed: string, reason: string, evidence: string[]): PlanRevision {
  const normalizedReason = bounded(reason, 2_000); if (!normalizedReason) throw new Error('Plan revisions require a reason.');
  return { revision: current.revisions.length + 1, createdAt: new Date().toISOString(), changed: bounded(changed, 2_000), reason: normalizedReason, evidence: list(evidence) };
}
function renderPlan(value: PlanningArtifact): string {
  const section = (title: string, values: string[]) => `## ${title}\n\n${values.length ? values.map(item => `- ${item}`).join('\n') : '_None recorded._'}\n`;
  const revisions = value.revisions.length ? value.revisions.map(item => `### Revision ${item.revision} - ${item.createdAt}\n\n**Changed:** ${item.changed}\n\n**Why:** ${item.reason}\n\n${section('Supporting evidence', item.evidence)}`).join('\n') : '_No revisions._\n';
  return `# Plan: ${value.objective}\n\nStatus: **${value.status}**  \nHandoff: **${value.handoff}**\n\n${section('Acceptance criteria', value.acceptanceCriteria)}\n${section('Current understanding', value.currentUnderstanding)}\n${section('Proposed architecture and approach', value.approach)}\n${section('Expected files and areas', value.expectedAreas)}\n${section('Implementation stages', value.implementationStages)}\n${section('Verification plan', value.verificationPlan)}\n${section('Risks', value.risks)}\n${section('Open questions', value.openQuestions)}\n## Revision history\n\n${revisions}`;
}
function list(values: string[]): string[] { if (!Array.isArray(values)) throw new Error('Plan sections must be arrays.'); return [...new Set(values.map(value => bounded(value, 1_000)).filter(Boolean))].slice(0, 100); }
function bounded(value: string, maximum: number): string { return String(value ?? '').trim().slice(0, maximum); }
function validTaskId(value: string): boolean { return /^[a-zA-Z0-9._-]{1,128}$/.test(value); }
function validateTaskId(value: string): void { if (!validTaskId(value)) throw new Error('Task ID contains unsupported characters.'); }
function validatePlanDirectory(value: string): void { const normalized = value.replace(/\\/g, '/'); if (!normalized || path.isAbsolute(value) || normalized.split('/').includes('..')) throw new Error('Plan directory must be a safe workspace-relative path.'); }
function clone(value: PlanningArtifact): PlanningArtifact { return JSON.parse(JSON.stringify(value)) as PlanningArtifact; }
function validArtifact(value: unknown): value is PlanningArtifact {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.taskId === 'string' && typeof item.objective === 'string' && ['draft', 'approved'].includes(String(item.status)) && ['wait-for-approval', 'implement-automatically'].includes(String(item.handoff)) && Array.isArray(item.revisions) && ['acceptanceCriteria', 'currentUnderstanding', 'approach', 'expectedAreas', 'implementationStages', 'verificationPlan', 'risks', 'openQuestions'].every(key => Array.isArray(item[key]));
}
