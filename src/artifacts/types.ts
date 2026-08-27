export const ARTIFACT_FORMATS = ['text', 'markdown', 'source', 'json', 'csv', 'pdf', 'docx', 'xlsx', 'image', 'unknown'] as const;
export type ArtifactFormat = typeof ARTIFACT_FORMATS[number];
export type TaskArtifact = {
  id: string; taskId: string; name: string; mediaType: string; format: ArtifactFormat; source: 'composer' | 'clipboard' | 'drop' | 'screenshot';
  originalPath: string; extractedPath?: string; indexPath?: string; bytes: number; sha256: string; truncated: boolean;
  visionStatus?: 'not-required' | 'pending-delegation' | 'observed'; visionObservation?: string; createdAt: string;
};
export type ArtifactChunk = { artifactId: string; sequence: number; text: string; terms: string[]; start: number; end: number };
