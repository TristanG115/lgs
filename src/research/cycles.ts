import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { EvidenceRecord, ResearchBudgets, ResearchConclusion, ResearchCycle, ResearchExperiment, ResearchNotebook } from './types.js';

export class RepeatedApproachError extends Error {
  readonly code = 'REPEATED_APPROACH';
  constructor(readonly similar: ResearchExperiment, readonly similarity: number) {
    super(`REPEATED_APPROACH\n\nSimilar to: Experiment #${similar.sequence}\n\nPrevious result:\n${similar.actualObservation ?? similar.learned ?? 'No observation recorded.'}\n\nProvide a materially different hypothesis or explain the new evidence.`);
  }
}

export class FileResearchCycleStore {
  constructor(private readonly workspaceRoot: string) {}
  read(taskId: string): ResearchNotebook | undefined {
    if (!validTaskId(taskId)) return;
    try { const value = JSON.parse(fs.readFileSync(this.jsonFile(taskId), 'utf8')) as unknown; return validNotebook(value) ? clone(value) : undefined; }
    catch { return; }
  }
  initialize(taskId: string, question: string): ResearchNotebook {
    validateTaskId(taskId); const existing = this.read(taskId); if (existing) return existing;
    const now = new Date().toISOString(); const value: ResearchNotebook = { taskId, researchQuestion: bounded(question, 4_000), establishedFacts: [], uncertainClaims: [], currentHypotheses: [], importantSources: [], experiments: [], rejectedApproaches: [], currentBestExplanation: '', remainingUnknowns: [], currentRecommendation: '', cycles: [], status: 'active', createdAt: now, updatedAt: now };
    this.write(value); return clone(value);
  }
  save(value: ResearchNotebook): void { validateTaskId(value.taskId); value.updatedAt = new Date().toISOString(); this.write(value); }
  private write(value: ResearchNotebook): void { const file = this.jsonFile(value.taskId); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); fs.writeFileSync(this.markdownFile(value.taskId), renderNotebook(value)); }
  private jsonFile(taskId: string): string { return path.join(this.workspaceRoot, '.lgs', 'tasks', taskId, 'research-cycles.json'); }
  private markdownFile(taskId: string): string { return path.join(this.workspaceRoot, '.lgs', 'tasks', taskId, 'RESEARCH.md'); }
}

export class ResearchCycleEngine {
  constructor(private readonly store: FileResearchCycleStore, private readonly budgets: ResearchBudgets, private readonly usage: (taskId: string) => { tokens: number; costUsd: number } = () => ({ tokens: 0, costUsd: 0 })) {}

  start(taskId: string, input: { question: string; evidence?: EvidenceRecord[]; hypothesis: string; confidence: number; experiment: string; expectedObservation: string; nextAction?: string; repetitionJustification?: string }): ResearchCycle {
    const notebook = this.store.initialize(taskId, input.question); this.assertBudget(notebook);
    if (notebook.status !== 'active') throw new Error(`Research is ${notebook.status}. Resume it before starting another cycle.`);
    const prior = repeatedExperiment(input.hypothesis, input.experiment, notebook.experiments);
    if (prior && !bounded(input.repetitionJustification ?? '', 2_000)) throw new RepeatedApproachError(prior.experiment, prior.similarity);
    const now = new Date().toISOString(); const experiment: ResearchExperiment = { id: randomUUID(), sequence: notebook.experiments.length + 1, hypothesis: bounded(input.hypothesis, 4_000), proposedExperiment: bounded(input.experiment, 4_000), expectedObservation: bounded(input.expectedObservation, 4_000), evidence: [], status: 'proposed', createdAt: now, repetitionJustification: bounded(input.repetitionJustification ?? '', 2_000) || undefined };
    const cycle: ResearchCycle = { id: randomUUID(), sequence: notebook.cycles.length + 1, researchQuestion: bounded(input.question, 4_000), currentEvidence: clone(input.evidence ?? []), hypothesis: experiment.hypothesis, confidence: confidence(input.confidence), experiment, nextAction: bounded(input.nextAction ?? input.experiment, 2_000), status: 'active', createdAt: now };
    notebook.researchQuestion = cycle.researchQuestion; notebook.currentHypotheses = unique([...notebook.currentHypotheses, cycle.hypothesis]); notebook.experiments.push(experiment); notebook.cycles.push(cycle); this.store.save(notebook); return clone(cycle);
  }

  complete(taskId: string, cycleId: string, input: { actualObservation: string; analysis: string; conclusion: ResearchConclusion; learned: string; evidence?: string[]; nextAction: string; bestExplanation?: string; remainingUnknowns?: string[]; recommendation?: string }): ResearchCycle {
    const notebook = this.require(taskId); const cycle = notebook.cycles.find(item => item.id === cycleId);
    if (!cycle || cycle.status !== 'active') throw new Error('An active research cycle was not found.');
    const now = new Date().toISOString(); const experiment = notebook.experiments.find(item => item.id === cycle.experiment.id)!;
    Object.assign(experiment, { actualObservation: bounded(input.actualObservation, 6_000), analysis: bounded(input.analysis, 6_000), conclusion: input.conclusion, learned: bounded(input.learned, 4_000), evidence: unique(input.evidence ?? []), status: 'completed' as const, completedAt: now });
    Object.assign(cycle.experiment, clone(experiment)); Object.assign(cycle, { conclusion: input.conclusion, nextAction: bounded(input.nextAction, 2_000), status: 'completed' as const, completedAt: now });
    if (input.conclusion === 'REJECTED') notebook.rejectedApproaches = unique([...notebook.rejectedApproaches, cycle.hypothesis]);
    notebook.currentBestExplanation = bounded(input.bestExplanation ?? notebook.currentBestExplanation, 6_000); notebook.remainingUnknowns = unique(input.remainingUnknowns ?? notebook.remainingUnknowns); notebook.currentRecommendation = bounded(input.recommendation ?? input.nextAction, 4_000);
    this.store.save(notebook); this.pauseIfBudgetExhausted(notebook); return clone(cycle);
  }

  addEvidence(taskId: string, records: EvidenceRecord[]): ResearchNotebook {
    const notebook = this.require(taskId);
    for (const record of records) {
      const target = record.state === 'CONFIRMED' || record.state === 'STRONG' ? notebook.establishedFacts : notebook.uncertainClaims;
      const other = target === notebook.establishedFacts ? notebook.uncertainClaims : notebook.establishedFacts;
      const index = other.findIndex(item => item.id === record.id); if (index >= 0) other.splice(index, 1);
      const existing = target.findIndex(item => item.id === record.id); if (existing >= 0) target[existing] = clone(record); else target.push(clone(record));
      notebook.importantSources = unique([...notebook.importantSources, ...record.provenance]);
    }
    this.store.save(notebook); return clone(notebook);
  }

  pause(taskId: string, reason: string): ResearchNotebook { const notebook = this.require(taskId); notebook.status = 'paused'; notebook.pauseReason = bounded(reason, 2_000); this.store.save(notebook); return clone(notebook); }
  resume(taskId: string): ResearchNotebook { const notebook = this.require(taskId); notebook.status = 'active'; notebook.pauseReason = undefined; this.store.save(notebook); return clone(notebook); }
  completeResearch(taskId: string): ResearchNotebook { const notebook = this.require(taskId); const latest = notebook.cycles.at(-1); if (!latest || latest.status !== 'completed' || !['SUPPORTED', 'PARTIAL'].includes(latest.conclusion ?? '')) throw new Error('A supported, completed cycle is required before completing research.'); if (!notebook.establishedFacts.some(item => item.state === 'CONFIRMED' || item.state === 'STRONG')) throw new Error('Research completion requires confirmed or strong evidence, not model confidence alone.'); notebook.status = 'completed'; this.store.save(notebook); return clone(notebook); }
  private require(taskId: string): ResearchNotebook { const value = this.store.read(taskId); if (!value) throw new Error('Research notebook was not found.'); return value; }
  private assertBudget(notebook: ResearchNotebook): void { const reason = budgetReason(notebook, this.budgets, this.usage(notebook.taskId)); if (reason) { this.pause(notebook.taskId, reason); throw new Error(`RESEARCH_PAUSED: ${reason}`); } }
  private pauseIfBudgetExhausted(notebook: ResearchNotebook): void { const reason = budgetReason(notebook, this.budgets, this.usage(notebook.taskId)); if (reason) this.pause(notebook.taskId, reason); }
}

function repeatedExperiment(hypothesis: string, experiment: string, previous: ResearchExperiment[]): { experiment: ResearchExperiment; similarity: number } | undefined {
  const target = tokens(`${hypothesis} ${experiment}`); let best: { experiment: ResearchExperiment; similarity: number } | undefined;
  for (const candidate of previous.filter(item => item.status === 'completed' && ['REJECTED', 'INCONCLUSIVE'].includes(item.conclusion ?? ''))) { const similarity = jaccard(target, tokens(`${candidate.hypothesis} ${candidate.proposedExperiment}`)); if (similarity >= .72 && (!best || similarity > best.similarity)) best = { experiment: candidate, similarity }; }
  return best;
}
function budgetReason(notebook: ResearchNotebook, budgets: ResearchBudgets, usage: { tokens: number; costUsd: number }): string | undefined {
  if (notebook.cycles.length >= budgets.maximumCycles) return `Maximum cycle budget (${budgets.maximumCycles}) exhausted.`;
  const failed = [...notebook.cycles].reverse().findIndex(item => item.conclusion === 'SUPPORTED'); const consecutive = failed < 0 ? notebook.cycles.filter(item => item.status === 'completed' && item.conclusion !== 'SUPPORTED').length : failed;
  if (consecutive >= budgets.maximumConsecutiveFailedCycles) return `Maximum consecutive failed-cycle budget (${budgets.maximumConsecutiveFailedCycles}) exhausted.`;
  if (Date.now() - Date.parse(notebook.createdAt) >= budgets.wallClockMinutes * 60_000) return `Wall-clock research budget (${budgets.wallClockMinutes} minutes) exhausted.`;
  if (budgets.maximumTokens !== undefined && usage.tokens >= budgets.maximumTokens) return `Research token budget (${budgets.maximumTokens}) exhausted.`;
  if (budgets.maximumCostUsd !== undefined && usage.costUsd >= budgets.maximumCostUsd) return `Research cloud-cost budget ($${budgets.maximumCostUsd}) exhausted.`;
  if (notebook.cycles.length >= budgets.minimumProgressCycles && notebook.cycles.slice(-budgets.minimumProgressCycles).every(item => item.conclusion === 'INCONCLUSIVE')) return `No meaningful progress occurred during the last ${budgets.minimumProgressCycles} cycles.`;
}
function renderNotebook(value: ResearchNotebook): string {
  const items = (title: string, values: string[]) => `## ${title}\n\n${values.length ? values.map(item => `- ${item}`).join('\n') : '_None recorded._'}\n`;
  const facts = value.establishedFacts.map(item => `[${item.state}] ${item.claim} (${item.provenance.join(', ') || 'no provenance'})`);
  const uncertain = value.uncertainClaims.map(item => `[${item.state}] ${item.claim} (${item.provenance.join(', ') || 'no provenance'})`);
  const experiments = value.experiments.map(item => `Experiment #${item.sequence}: ${item.proposedExperiment} -> ${item.status === 'completed' ? `${item.conclusion}: ${item.learned}` : 'proposed'}`);
  return `# Research Notebook\n\nStatus: **${value.status}**${value.pauseReason ? ` - ${value.pauseReason}` : ''}\n\n## Research question\n\n${value.researchQuestion}\n\n${items('Established facts', facts)}\n${items('Uncertain claims', uncertain)}\n${items('Current hypotheses', value.currentHypotheses)}\n${items('Important sources', value.importantSources)}\n${items('Experiment summaries', experiments)}\n${items('Rejected approaches', value.rejectedApproaches)}\n## Current best explanation\n\n${value.currentBestExplanation || '_Not established._'}\n\n${items('Remaining unknowns', value.remainingUnknowns)}\n## Current recommendation\n\n${value.currentRecommendation || '_No recommendation yet._'}\n`;
}
function tokens(value: string): Set<string> { return new Set(value.toLowerCase().match(/[a-z0-9][a-z0-9._-]{2,}/g) ?? []); }
function jaccard(left: Set<string>, right: Set<string>): number { const intersection = [...left].filter(value => right.has(value)).length; const union = new Set([...left, ...right]).size; return union ? intersection / union : 0; }
function confidence(value: number): number { if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Research confidence must be between 0 and 1.'); return Math.round(value * 1000) / 1000; }
function unique(values: string[]): string[] { return [...new Set(values.map(value => bounded(value, 4_000)).filter(Boolean))].slice(0, 500); }
function bounded(value: string, maximum: number): string { return String(value ?? '').trim().slice(0, maximum); }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function validTaskId(value: string): boolean { return /^[a-zA-Z0-9._-]{1,128}$/.test(value); }
function validateTaskId(value: string): void { if (!validTaskId(value)) throw new Error('Task ID contains unsupported characters.'); }
function validNotebook(value: unknown): value is ResearchNotebook { if (typeof value !== 'object' || value === null || Array.isArray(value)) return false; const item = value as Record<string, unknown>; return typeof item.taskId === 'string' && typeof item.researchQuestion === 'string' && Array.isArray(item.cycles) && Array.isArray(item.experiments) && ['active', 'paused', 'completed'].includes(String(item.status)); }
