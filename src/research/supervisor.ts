import type { ResearchCycle, ResearchNotebook } from './types.js';

export type ResearchSupervision = { status: 'ON_TRACK' | 'WEAK_EVIDENCE' | 'REPEATED' | 'DRIFT' | 'NO_PROGRESS'; findings: string[]; nextAction: string };

/** Read-only deterministic baseline for a model-assisted research supervisor. */
export class ResearchSupervisor {
  evaluate(notebook: ResearchNotebook, cycle: ResearchCycle): ResearchSupervision {
    if (cycle.researchQuestion !== notebook.researchQuestion) return finding('DRIFT', ['Cycle research question differs from the notebook question.'], 'Restate the experiment against the original research question.');
    if (!related(cycle.hypothesis, cycle.experiment.proposedExperiment)) return finding('DRIFT', ['The proposed experiment has little lexical connection to its hypothesis.'], 'Explain how the experiment tests the stated hypothesis.');
    if (cycle.status === 'completed' && !cycle.experiment.actualObservation?.trim()) return finding('NO_PROGRESS', ['The experiment completed without an actual observation.'], 'Record the observation, including unsuccessful results and what they taught.');
    if (cycle.conclusion === 'SUPPORTED' && !cycle.experiment.evidence.length && !cycle.currentEvidence.some(item => ['CONFIRMED', 'STRONG'].includes(item.state))) return finding('WEAK_EVIDENCE', ['A supported conclusion lacks strong evidence provenance.'], 'Gather confirmed or strong evidence before accepting the conclusion.');
    return finding('ON_TRACK', [`Experiment #${cycle.experiment.sequence} tests the active hypothesis and preserves observations.`], cycle.status === 'active' ? 'Run the proposed experiment.' : cycle.nextAction);
  }
}
function related(hypothesis: string, experiment: string): boolean { const ignored = new Set(['does', 'that', 'this', 'with', 'from', 'have', 'will', 'expected', 'result', 'returns']); const terms = (hypothesis.toLowerCase().match(/[a-z0-9][a-z0-9_-]*/g) ?? []).filter(term => !ignored.has(term)); const target = new Set(experiment.toLowerCase().match(/[a-z0-9][a-z0-9_-]*/g) ?? []); return terms.length === 0 || terms.some(term => target.has(term)); }
function finding(status: ResearchSupervision['status'], findings: string[], nextAction: string): ResearchSupervision { return { status, findings, nextAction }; }
