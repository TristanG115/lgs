import { registerGitTools, type GitBaseline, type GitCommandRunner } from './git.js';
import { createRepositoryToolRegistry } from './repository.js';
import type { ToolRegistry } from './framework.js';
import { registerVerificationTools, type VerificationRunner } from '../verification/index.js';
import type { RawExecutionLogStore } from '../execution/index.js';
import { registerCompletionTools, type CompletionGuard, type FileCompletionEvidenceStore } from '../completion/index.js';
import { registerOrchestrationTools, type Orchestrator } from '../orchestration/index.js';
import { registerWatchdogTools, type FileTaskStateStore, type WatchdogService } from '../watchdog/index.js';
import { registerResearchTools, type FileResearchStore, type ResearchService } from '../research/index.js';
import { registerDocumentationTools, type DocumentationAgent, type FileDocumentationAuditStore } from '../documentation/index.js';
import { registerReviewTools, type FileReviewStore, type IndependentReviewer } from '../review/index.js';
import { registerRuntimeTools, type FileRuntimeStore, type ManagedProcessManager, type RuntimeVerifier } from '../runtime/index.js';

export function createWorkspaceToolRegistry(options: { gitBaseline?: GitBaseline; gitRunner?: GitCommandRunner; verificationRunner?: VerificationRunner; executionLogs?: RawExecutionLogStore; completionGuard?: CompletionGuard; completionEvidence?: FileCompletionEvidenceStore; orchestrator?: Orchestrator; managerAgentId?: string; taskState?: FileTaskStateStore; watchdog?: WatchdogService; research?: ResearchService; researchStore?: FileResearchStore; documentationAgent?: DocumentationAgent; documentationStore?: FileDocumentationAuditStore; independentReviewer?: IndependentReviewer; reviewStore?: FileReviewStore; processes?: ManagedProcessManager; runtimeVerifier?: RuntimeVerifier; runtimeStore?: FileRuntimeStore } = {}): ToolRegistry {
  const registry = registerGitTools(createRepositoryToolRegistry(), { baseline: options.gitBaseline, runner: options.gitRunner });
  if (options.verificationRunner && options.executionLogs) registerVerificationTools(registry, options.verificationRunner, options.executionLogs);
  if (options.completionGuard && options.completionEvidence) registerCompletionTools(registry, options.completionGuard, options.completionEvidence);
  if (options.orchestrator && options.managerAgentId) registerOrchestrationTools(registry, options.orchestrator, options.managerAgentId);
  if (options.taskState && options.watchdog) registerWatchdogTools(registry, options.taskState, options.watchdog);
  if (options.research && options.researchStore) registerResearchTools(registry, options.research, options.researchStore);
  if (options.documentationAgent && options.documentationStore) registerDocumentationTools(registry, options.documentationAgent, options.documentationStore);
  if (options.independentReviewer && options.reviewStore) registerReviewTools(registry, options.independentReviewer, options.reviewStore);
  if (options.processes && options.runtimeVerifier && options.runtimeStore) registerRuntimeTools(registry, options.processes, options.runtimeVerifier, options.runtimeStore);
  return registry;
}
