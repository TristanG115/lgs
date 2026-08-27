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
import { registerCommitTools, VerifiedCommitService } from '../commit/index.js';
import { registerKnowledgeTools, ProjectMemoryStore, WorkspaceSkillStore } from '../knowledge/index.js';
import { registerPlanningTools } from '../planning/index.js';
import { registerIntegrationTools, type IntegrationHub } from '../integrations/index.js';
import { BenchmarkStore, LocalRuntimeDiscovery, registerLocalRuntimeTools } from '../localruntime/index.js';
import { FilePricingStore, registerUsageTools, type UsageTracker } from '../usage/index.js';

export function createWorkspaceToolRegistry(options: { gitBaseline?: GitBaseline; gitRunner?: GitCommandRunner; verificationRunner?: VerificationRunner; executionLogs?: RawExecutionLogStore; completionGuard?: CompletionGuard; completionEvidence?: FileCompletionEvidenceStore; orchestrator?: Orchestrator; managerAgentId?: string; taskState?: FileTaskStateStore; watchdog?: WatchdogService; research?: ResearchService; researchStore?: FileResearchStore; documentationAgent?: DocumentationAgent; documentationStore?: FileDocumentationAuditStore; independentReviewer?: IndependentReviewer; reviewStore?: FileReviewStore; processes?: ManagedProcessManager; runtimeVerifier?: RuntimeVerifier; runtimeStore?: FileRuntimeStore; commitService?: VerifiedCommitService; skills?: WorkspaceSkillStore; memories?: ProjectMemoryStore; integrations?: IntegrationHub; usage?: UsageTracker; pricing?: FilePricingStore } = {}): ToolRegistry {
  const registry = registerGitTools(createRepositoryToolRegistry(), { baseline: options.gitBaseline, runner: options.gitRunner });
  if (options.verificationRunner && options.executionLogs) registerVerificationTools(registry, options.verificationRunner, options.executionLogs);
  if (options.completionGuard && options.completionEvidence) registerCompletionTools(registry, options.completionGuard, options.completionEvidence);
  if (options.orchestrator && options.managerAgentId) registerOrchestrationTools(registry, options.orchestrator, options.managerAgentId);
  if (options.taskState && options.watchdog) registerWatchdogTools(registry, options.taskState, options.watchdog);
  if (options.research && options.researchStore) registerResearchTools(registry, options.research, options.researchStore);
  if (options.documentationAgent && options.documentationStore) registerDocumentationTools(registry, options.documentationAgent, options.documentationStore);
  if (options.independentReviewer && options.reviewStore) registerReviewTools(registry, options.independentReviewer, options.reviewStore);
  if (options.processes && options.runtimeVerifier && options.runtimeStore) registerRuntimeTools(registry, options.processes, options.runtimeVerifier, options.runtimeStore);
  const commitService = options.commitService ?? (options.completionGuard && options.taskState && options.gitBaseline
    ? new VerifiedCommitService(options.gitBaseline.workspaceRoot, options.completionGuard, options.taskState, options.gitBaseline)
    : undefined);
  if (commitService) registerCommitTools(registry, commitService);
  const skills = options.skills ?? (options.gitBaseline ? new WorkspaceSkillStore(options.gitBaseline.workspaceRoot) : undefined);
  const memories = options.memories ?? (options.gitBaseline ? new ProjectMemoryStore(options.gitBaseline.workspaceRoot) : undefined);
  if (skills && memories) registerKnowledgeTools(registry, skills, memories);
  if (options.taskState) registerPlanningTools(registry, options.taskState);
  if (options.integrations) registerIntegrationTools(registry, options.integrations);
  if (options.gitBaseline) registerLocalRuntimeTools(registry, new LocalRuntimeDiscovery(), new BenchmarkStore(options.gitBaseline.workspaceRoot));
  if (options.usage && options.pricing) registerUsageTools(registry, options.usage, options.pricing);
  return registry;
}
