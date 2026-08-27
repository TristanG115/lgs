export type EditKind = 'replace' | 'create' | 'delete' | 'rename';
export type FileSnapshot = { content: string; hash: string; mode: number };
export type EditOperation = {
  id: string;
  taskId: string;
  kind: EditKind;
  path: string;
  destination?: string;
  before?: FileSnapshot;
  afterHash?: string;
  createdAt: string;
  undoneAt?: string;
};
export type EditPermissionPrompt = (request: { operation: EditKind | 'undo'; path: string; destination?: string }) => Promise<boolean>;
