import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TaskArtifactPipeline } from './pipeline.js';
import type { TaskArtifact } from './types.js';

export type VisionObservation = { summary: string; visibleText: string[]; objects: string[]; uncertainties: string[] };
export interface VisionAnalyzer { analyze(input: { path: string; mediaType: string; taskId: string; signal?: AbortSignal }): Promise<VisionObservation>; }

/** Delegates only image interpretation; the Manager receives a concise observation while the source artifact remains local. */
export class VisionRouter {
  constructor(private readonly workspaceRoot: string, private readonly artifacts: TaskArtifactPipeline, private readonly analyzer?: VisionAnalyzer) {}
  async observe(taskId: string, artifact: TaskArtifact, primaryHasVision: boolean, authorized: boolean, signal?: AbortSignal): Promise<VisionObservation> {
    if (artifact.format !== 'image') throw new Error('Vision routing requires an image artifact.');
    if (!primaryHasVision && (!authorized || !this.analyzer)) throw new Error('VISION_MODEL_REQUIRED: authorize a vision-capable model for this task.');
    if (!this.analyzer) throw new Error('No vision analyzer is configured.');
    const target = path.join(this.workspaceRoot, artifact.originalPath); if (!fs.existsSync(target)) throw new Error('The retained source image was not found.');
    const raw = await this.analyzer.analyze({ path: target, mediaType: artifact.mediaType, taskId, signal });
    const observation: VisionObservation = { summary: bounded(raw.summary, 2_000), visibleText: list(raw.visibleText), objects: list(raw.objects), uncertainties: list(raw.uncertainties) };
    this.artifacts.recordVisionObservation(taskId, artifact.id, JSON.stringify(observation)); return observation;
  }
}
function list(values: string[]): string[] { return [...new Set(values.map(value => bounded(value, 500)).filter(Boolean))].slice(0, 100); }
function bounded(value: string, maximum: number): string { return String(value ?? '').trim().slice(0, maximum); }
