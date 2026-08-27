import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractExternalFile } from '../computer/agent.js';
import type { ArtifactChunk, ArtifactFormat, TaskArtifact } from './types.js';

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const CHUNK_CHARACTERS = 8_000;

/** Copies attachments into task ownership, extracts deterministic content, and indexes large text for selective retrieval. */
export class TaskArtifactPipeline {
  constructor(private readonly workspaceRoot: string) {}
  ingest(taskId: string, input: { name: string; mediaType: string; data: Uint8Array; source: TaskArtifact['source']; primaryModelHasVision?: boolean }): TaskArtifact {
    validateTaskId(taskId); const safeName = sanitizeName(input.name); if (!input.data.byteLength || input.data.byteLength > MAX_ATTACHMENT_BYTES) throw new Error(`Attachment size must be between 1 byte and ${MAX_ATTACHMENT_BYTES} bytes.`);
    const format = formatOf(safeName, input.mediaType); const id = randomUUID(); const directory = path.join(this.workspaceRoot, '.lgs', 'tasks', taskId, 'artifacts', id); fs.mkdirSync(directory, { recursive: true });
    const original = path.join(directory, safeName); fs.writeFileSync(original, input.data); const relativeOriginal = path.relative(this.workspaceRoot, original);
    const extracted = extractExternalFile(original); let extractedPath: string | undefined; let indexPath: string | undefined;
    if (extracted.text) { extractedPath = path.join(directory, 'extracted.txt'); fs.writeFileSync(extractedPath, extracted.text); }
    else if (extracted.structured !== undefined) { extractedPath = path.join(directory, 'extracted.json'); fs.writeFileSync(extractedPath, JSON.stringify(extracted.structured, null, 2) + '\n'); }
    const text = extracted.text ?? (extracted.structured === undefined ? '' : JSON.stringify(extracted.structured));
    if (text.length > CHUNK_CHARACTERS) { const chunks = chunksOf(id, text); indexPath = path.join(directory, 'index.json'); fs.writeFileSync(indexPath, JSON.stringify(chunks, null, 2) + '\n'); }
    const artifact: TaskArtifact = { id, taskId, name: safeName, mediaType: input.mediaType.slice(0, 200), format, source: input.source, originalPath: relativeOriginal, extractedPath: extractedPath ? path.relative(this.workspaceRoot, extractedPath) : undefined, indexPath: indexPath ? path.relative(this.workspaceRoot, indexPath) : undefined, bytes: input.data.byteLength, sha256: createHash('sha256').update(input.data).digest('hex'), truncated: extracted.truncated, visionStatus: format === 'image' ? input.primaryModelHasVision === false ? 'pending-delegation' : 'not-required' : undefined, createdAt: new Date().toISOString() };
    this.append(taskId, artifact); return clone(artifact);
  }
  ingestFile(taskId: string, file: string, source: TaskArtifact['source'] = 'composer', primaryModelHasVision?: boolean): TaskArtifact { const stats = fs.statSync(file); if (!stats.isFile()) throw new Error('Attachment path must be a file.'); return this.ingest(taskId, { name: path.basename(file), mediaType: mediaTypeOf(file), data: fs.readFileSync(file), source, primaryModelHasVision }); }
  list(taskId: string): TaskArtifact[] { if (!validTaskId(taskId)) return []; try { const value = JSON.parse(fs.readFileSync(this.manifest(taskId), 'utf8')) as unknown; return Array.isArray(value) ? value as TaskArtifact[] : []; } catch { return []; } }
  retrieve(taskId: string, query: string, maximumChunks = 6): ArtifactChunk[] {
    const terms = tokens(query); const candidates: (ArtifactChunk & { score: number })[] = [];
    for (const artifact of this.list(taskId)) {
      if (!artifact.indexPath) continue;
      try { const chunks = JSON.parse(fs.readFileSync(path.join(this.workspaceRoot, artifact.indexPath), 'utf8')) as ArtifactChunk[]; for (const chunk of chunks) candidates.push({ ...chunk, score: chunk.terms.filter(term => terms.has(term)).length }); } catch { /* Corrupt indexes are ignored, originals remain retained. */ }
    }
    return candidates.sort((left, right) => right.score - left.score || left.artifactId.localeCompare(right.artifactId) || left.sequence - right.sequence).slice(0, Math.max(1, Math.min(20, maximumChunks))).map(item => ({ artifactId: item.artifactId, sequence: item.sequence, text: item.text, terms: [...item.terms], start: item.start, end: item.end }));
  }
  recordVisionObservation(taskId: string, artifactId: string, observation: string): TaskArtifact {
    const artifacts = this.list(taskId); const artifact = artifacts.find(item => item.id === artifactId); if (!artifact || artifact.format !== 'image') throw new Error('Image artifact was not found.'); artifact.visionStatus = 'observed'; artifact.visionObservation = observation.trim().slice(0, 4_000); this.writeManifest(taskId, artifacts); return clone(artifact);
  }
  private append(taskId: string, artifact: TaskArtifact): void { const values = this.list(taskId); values.push(artifact); this.writeManifest(taskId, values); }
  private manifest(taskId: string): string { return path.join(this.workspaceRoot, '.lgs', 'tasks', taskId, 'artifacts.json'); }
  private writeManifest(taskId: string, artifacts: TaskArtifact[]): void { const file = this.manifest(taskId); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(artifacts.slice(-500), null, 2) + '\n'); }
}

function chunksOf(artifactId: string, text: string): ArtifactChunk[] { const chunks: ArtifactChunk[] = []; for (let start = 0, sequence = 1; start < text.length; start += CHUNK_CHARACTERS, sequence++) { const value = text.slice(start, start + CHUNK_CHARACTERS); chunks.push({ artifactId, sequence, text: value, terms: [...tokens(value)].slice(0, 500), start, end: start + value.length }); } return chunks; }
function formatOf(name: string, mediaType: string): ArtifactFormat { const extension = path.extname(name).toLowerCase(); if (['.txt'].includes(extension)) return 'text'; if (['.md', '.markdown'].includes(extension)) return 'markdown'; if (extension === '.json') return 'json'; if (extension === '.csv') return 'csv'; if (extension === '.pdf') return 'pdf'; if (extension === '.docx') return 'docx'; if (extension === '.xlsx') return 'xlsx'; if (mediaType.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(extension)) return 'image'; if (/^\.(?:[cm]?[jt]sx?|py|rb|rs|go|java|kt|swift|c|cc|cpp|h|hpp|cs|php|sh|sql|ya?ml|toml|xml|html|css|scss)$/.test(extension)) return 'source'; return 'unknown'; }
function mediaTypeOf(file: string): string { const extension = path.extname(file).toLowerCase(); return extension === '.pdf' ? 'application/pdf' : extension === '.json' ? 'application/json' : extension === '.csv' ? 'text/csv' : extension === '.png' ? 'image/png' : ['.jpg', '.jpeg'].includes(extension) ? 'image/jpeg' : 'application/octet-stream'; }
function sanitizeName(value: string): string { const name = path.basename(value).replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 180); if (!name || name === '.' || name === '..') throw new Error('Attachment name is invalid.'); return name; }
function tokens(value: string): Set<string> { return new Set(value.toLowerCase().match(/[a-z0-9][a-z0-9._-]{2,}/g) ?? []); }
function validTaskId(value: string): boolean { return /^[a-zA-Z0-9._-]{1,128}$/.test(value); }
function validateTaskId(value: string): void { if (!validTaskId(value)) throw new Error('Task ID contains unsupported characters.'); }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
