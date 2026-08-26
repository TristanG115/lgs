export type LocalRuntimeKind = 'ollama' | 'lm-studio' | 'llama-cpp' | 'openai-compatible';
export type LocalRuntimeStatus = 'healthy' | 'unreachable' | 'owned' | 'error';
export type LocalModelMetrics = { promptTokens?: number; outputTokens?: number; promptProcessingMs?: number; generationMs?: number; tokensPerSecond?: number; totalLatencyMs: number; contextSize?: number; contextUtilization?: number };
export type LocalRuntimeRecord = { id: string; kind: LocalRuntimeKind; baseUrl: string; status: LocalRuntimeStatus; models: string[]; loadedModels: string[]; capabilities: string[]; ownedByLgs: boolean; checkedAt: string; error?: string };
export type BenchmarkCase = 'repository-navigation' | 'tool-selection' | 'small-implementation' | 'debugging' | 'code-review' | 'instruction-following' | 'planning';
export type BenchmarkRecord = { id: string; model: string; runtimeId: string; case: BenchmarkCase; metrics: LocalModelMetrics; quality?: { score: number; notes?: string }; recordedAt: string };
