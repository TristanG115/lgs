import type { ContextBreakdown, ContextSavings } from '../usage/types.js';

export const CONTEXT_LEVELS = ['repository', 'module', 'directory', 'file', 'symbol', 'source-range'] as const;
export type ContextLevel = typeof CONTEXT_LEVELS[number];
export type ContextCategory = keyof ContextBreakdown;

export type ContextCandidate = {
  id: string;
  level: ContextLevel;
  category: ContextCategory;
  content: string;
  path?: string;
  symbol?: string;
  range?: { startLine: number; endLine: number };
  imports?: string[];
  reverseDependencies?: string[];
  relatedTests?: string[];
  gitRelevance?: number;
  researchRelevance?: number;
  semanticRelevance?: number;
  agentRequested?: boolean;
  required?: boolean;
  dedupKey?: string;
  tokenCount?: number;
};

export type ContextRequest = {
  objective: string;
  tokenBudget: number;
  candidates: ContextCandidate[];
  requestedPaths?: string[];
  requestedSymbols?: string[];
};

export type ContextSelection = {
  selected: (ContextCandidate & { estimatedTokens: number; score: number })[];
  omitted: { id: string; reason: 'duplicate' | 'budget' | 'lower-relevance' }[];
  metrics: { candidateTokens: number; selectedTokens: number; tokensSaved: number; savingsPercentage: number; categoryBreakdown: ContextBreakdown; savings: ContextSavings };
};
