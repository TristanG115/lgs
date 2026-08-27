import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ToolDefinition, ToolIdentity } from '../tools/types.js';
import type { AutoResearchMode, ResearchFinding, ResearchRequirement, ResearchTrigger } from './types.js';

const UNCERTAINTY = /\b(?:i am|i'm|we are|we're)\s+(?:not sure|uncertain)|\b(?:unclear|unknown|unfamiliar behavior|need clarification)\b/i;
const VERSION_SENSITIVE = /\b(?:latest|current|version[- ]sensitive|as of|deprecated|release|api version|breaking change|supported versions?)\b/i;
const EXTERNAL_ASSUMPTION = /\b(?:documentation says|upstream|external api|browser behavior|provider supports|service requires)\b/i;

export function detectResearchTriggers(text: string, mode: AutoResearchMode, watchdogClassification?: string): ResearchTrigger[] {
  const triggers: ResearchTrigger[] = [];
  if (UNCERTAINTY.test(text)) triggers.push('explicit-uncertainty');
  if (VERSION_SENSITIVE.test(text)) triggers.push('version-sensitive-assumption');
  if (EXTERNAL_ASSUMPTION.test(text) && !/https?:\/\//i.test(text)) triggers.push('unsupported-external-assumption');
  if (watchdogClassification === 'NEEDS_RESEARCH') triggers.push('watchdog-needs-research');
  if (mode === 'proactive' && (VERSION_SENSITIVE.test(text) || EXTERNAL_ASSUMPTION.test(text))) triggers.push('proactive-decision');
  return [...new Set(triggers)];
}

export class FileResearchRequirementStore {
  constructor(private readonly workspaceRoot: string) {}
  read(taskId: string): ResearchRequirement[] { if (!validTaskId(taskId)) return []; try { const value = JSON.parse(fs.readFileSync(this.file(taskId), 'utf8')) as unknown; return Array.isArray(value) ? value as ResearchRequirement[] : []; } catch { return []; } }
  require(taskId: string, trigger: ResearchTrigger, reason: string): ResearchRequirement {
    validateTaskId(taskId); const requirements = this.read(taskId); const active = requirements.find(item => !item.satisfiedAt && item.trigger === trigger && item.reason === reason); if (active) return active;
    const value = { id: randomUUID(), trigger, reason: reason.trim().slice(0, 2_000), createdAt: new Date().toISOString(), evidenceIds: [] }; requirements.push(value); this.write(taskId, requirements); return value;
  }
  satisfy(taskId: string, findings: ResearchFinding[]): ResearchRequirement[] {
    const requirements = this.read(taskId); if (!findings.length) return requirements;
    for (const requirement of requirements) if (!requirement.satisfiedAt) {
      const supporting = findings.filter(item => Date.parse(item.retrievedAt) >= Date.parse(requirement.createdAt) && relevant(requirement.reason, `${item.query} ${item.finding} ${item.title}`)); if (!supporting.length) continue;
      const latest = Math.max(...supporting.map(item => Date.parse(item.retrievedAt))); requirement.satisfiedAt = new Date(latest).toISOString(); requirement.evidenceIds = supporting.map(item => item.id);
    }
    this.write(taskId, requirements); return requirements;
  }
  active(taskId: string): ResearchRequirement[] { return this.read(taskId).filter(item => !item.satisfiedAt); }
  private file(taskId: string): string { return path.join(this.workspaceRoot, '.lgs', 'tasks', taskId, 'research-requirements.json'); }
  private write(taskId: string, values: ResearchRequirement[]): void { const file = this.file(taskId); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(values.slice(-200), null, 2) + '\n'); }
}

/** A deterministic execution barrier. Research and read-only inspection remain available while unsupported assumptions are unresolved. */
export class ResearchExecutionGuard {
  constructor(private readonly requirements: FileResearchRequirementStore, private readonly webEnabled: boolean) {}
  check(definition: ToolDefinition, identity: ToolIdentity): string | undefined {
    if (!identity.taskId || definition.permission.access === 'read-only' || researchTool(definition.id)) return;
    const active = this.requirements.active(identity.taskId); if (!active.length) return;
    if (!this.webEnabled) return `RESEARCH_REQUIRED: execution is blocked, but the Web capability is disabled. Enable Web or provide authoritative task evidence. ${active[0].reason}`;
    return `RESEARCH_REQUIRED: unsupported execution is blocked until authoritative research satisfies ${active.map(item => item.trigger).join(', ')}. ${active[0].reason}`;
  }
}

function researchTool(id: string): boolean { return ['web_search', 'web_fetch', 'documentation_search', 'repository_search', 'get_research_findings'].includes(id) || id.startsWith('research_'); }
function relevant(reason: string, evidence: string): boolean { const ignored = new Set(['about', 'after', 'before', 'could', 'latest', 'requires', 'supported', 'whether', 'unverified']); const terms = new Set((reason.toLowerCase().match(/[a-z0-9][a-z0-9._-]{2,}/g) ?? []).filter(term => !ignored.has(term))); const candidate = evidence.toLowerCase(); return terms.size === 0 || [...terms].some(term => candidate.includes(term)); }
function validTaskId(value: string): boolean { return /^[a-zA-Z0-9._-]{1,128}$/.test(value); }
function validateTaskId(value: string): void { if (!validTaskId(value)) throw new Error('Task ID contains unsupported characters.'); }
