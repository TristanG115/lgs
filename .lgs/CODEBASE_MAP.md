# LGS Codebase Map

Generated: 2026-08-26T15:05:31.616Z

This map is generated deterministically from the filesystem, manifests, and source syntax. Source files remain authoritative.

## Freshness

- Index: current
- Codebase Map: current
- Stale entries: none

## Repository shape

- Files: 62
- Directories: 13
- Modules: 4
- Entry points: src/extension.ts
- Manifests: package-lock.json, package.json, tsconfig.json

## Modules

### Repository root
- Path: .
- Files: 10; directories: 1
- Manifest: `package.json`
  - `.gitignore` — unknown
  - `.vscode/launch.json` — JSON
  - `.vscode/tasks.json` — JSON
  - `README.md` — Markdown/Text (documentation)
  - `esbuild.mjs` — JavaScript
    - Symbols: production, shared, extension, webview
  - `eslint.config.mjs` — JavaScript
  - `package-lock.json` — JSON
  - `package.json` — JSON
  - `tsconfig.json` — JSON
  - `vitest.config.ts` — TypeScript

### media
- Path: media
- Files: 1; directories: 1
  - `media/lgs.svg` — SVG

### src
- Path: src
- Files: 43; directories: 10
- Entry points: `src/extension.ts`
  - `src/completion/config.ts` — TypeScript
    - Symbols: DEFAULT_GATES, DEFAULT_BUDGETS, parseCompletionConfiguration, record
  - `src/completion/evidence.ts` — TypeScript
    - Symbols: RECORDABLE_REQUIREMENTS, FileCompletionEvidenceStore, validTaskId, validateTaskId, unique, validEvidence
  - `src/completion/failures.ts` — TypeScript
    - Symbols: FailureBudgetTracker, errorFingerprint, failedExecution
  - `src/completion/guard.ts` — TypeScript
    - Symbols: LABELS, STEP_REQUIREMENT, CompletionGuard, renderCompletionBlocked, commandItem, unresolvedItem
  - `src/completion/index.ts` — TypeScript
  - `src/completion/tools.ts` — TypeScript
    - Symbols: METADATA_PERMISSION, READ_PERMISSION, registerCompletionTools
  - `src/completion/types.ts` — TypeScript
    - Symbols: COMPLETION_REQUIREMENTS, CompletionRequirement, CompletionStatus, CompletionEvidenceSource, CompletionEvidence, CompletionChecklistItem, FailureBudgetConfiguration, CompletionGateConfiguration, CompletionConfiguration, FailureBudgetState, CompletionEvaluation, CompletionViewState
  - `src/execution/evidence.ts` — TypeScript
    - Symbols: TaskEvidenceSink, FileTaskEvidenceStore
  - `src/execution/index.ts` — TypeScript
  - `src/execution/logs.ts` — TypeScript
    - Symbols: RawExecutionLog, RawExecutionLogStore
  - `src/execution/normalize.ts` — TypeScript
    - Symbols: ERROR, STACK, LOCATION, MAX_STREAM_LINES, displayCommand, normalizeOutput, lines, unique, relevantPreview, hasLocation
  - `src/execution/permissions.ts` — TypeScript
    - Symbols: CommandPermissionResolver, findExecutable
  - `src/execution/service.ts` — TypeScript
    - Symbols: DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, INHERITED_ENV, CommandExecutionService, validateRequest, controlledEnvironment
  - `src/execution/types.ts` — TypeScript
    - Symbols: COMMAND_CATEGORIES, CommandCategory, PermissionPolicy, CommandDefinition, ExecutionRequest, PermissionConfiguration, PermissionResolution, ExecutionStatus, NormalizedCommandOutput, ExecutionResult, ExecutionEvidence, PermissionPrompt
  - `src/extension.ts` — TypeScript
    - Symbols: SavedChat, activate, deactivate, LgsViewProvider, getHtml, rebuildIndex, openCodebaseMap
  - `src/intelligence/indexer.ts` — TypeScript
    - Symbols: IndexedFile, RepositoryModule, RepositoryHierarchy, Freshness, RepositoryIndex, HARD_IGNORED, SOURCE, DOCS, MANIFESTS, readGitignore, isIgnored, discoverFiles
  - `src/model/anthropic.ts` — TypeScript
    - Symbols: AnthropicBackend
  - `src/model/backend.ts` — TypeScript
    - Symbols: BackendConfig, ModelBackend, httpError, jsonResponse, lines, authHeaders
  - `src/model/ollama.ts` — TypeScript
    - Symbols: OllamaBackend
  - `src/model/openai.ts` — TypeScript
    - Symbols: OpenAICompatibleBackend
  - `src/model/profiles.ts` — TypeScript
    - Symbols: ProviderKind, BackendProfile, defaultProfiles, normalizeProfile, loadProfiles, saveProfiles, createBackend
  - `src/model/registry.ts` — TypeScript
    - Symbols: BackendId, createBackends
  - `src/model/types.ts` — TypeScript
    - Symbols: Role, TextContent, ImageContent, Content, LgsMessage, GenerationOptions, ModelInfo, ModelCapabilities, ConnectionState, Usage, TokenInformation, BackendErrorCode
  - `src/settings/configuration.ts` — TypeScript
    - Symbols: SettingsManager
  - `src/settings/defaults.ts` — TypeScript
    - Symbols: SETTINGS_CATEGORIES, createDefaultRegistry, visibleSettings
  - `src/settings/panel.ts` — TypeScript
    - Symbols: PanelMessage, SettingsPanel, css, script
  - `src/settings/registry.ts` — TypeScript
    - Symbols: SettingScope, SettingType, SettingSource, SettingDefinition, EffectiveSetting, SettingsRegistry, resolveSetting
  - `src/shared/logger.ts` — TypeScript
    - Symbols: Logger
  - `src/shared/messages.ts` — TypeScript
    - Symbols: ChatOptions, ClientMessage, HostMessage, parseClientMessage, isHostMessage
  - `src/tools/framework.ts` — TypeScript
    - Symbols: DEFAULT_MAX_RESULT_BYTES, MAX_AUDIT_ARGUMENT_BYTES, SECRET_KEY, MemoryAuditSink, ToolRegistry, ToolExecutor, parseToolCall, boundData, errorResult, elapsed, toolError, throwIfCancelled

### test
- Path: test
- Files: 8; directories: 1
  - `test/completion.test.ts` — TypeScript (test)
    - Symbols: EvidenceEntry, fixture, cleanup, gates, execution, guard
  - `test/execution.test.ts` — TypeScript (test)
    - Symbols: fixture, cleanup, request
  - `test/git.test.ts` — TypeScript (test)
    - Symbols: git, repository, cleanup, call
  - `test/indexer.test.ts` — TypeScript (test)
    - Symbols: fixture, cleanup
  - `test/messages.test.ts` — TypeScript (test)
  - `test/settings.test.ts` — TypeScript (test)
    - Symbols: context
  - `test/stream.test.ts` — TypeScript (test)
  - `test/tools.test.ts` — TypeScript (test)
    - Symbols: fixture, cleanup, call

## Relationships

- `src/completion/config.ts` → `src/completion/types.ts`
- `src/completion/evidence.ts` → `src/completion/types.ts`
- `src/completion/failures.ts` → `src/execution/types.ts`
- `src/completion/failures.ts` → `src/completion/types.ts`
- `src/completion/guard.ts` → `src/intelligence/indexer.ts`
- `src/completion/guard.ts` → `src/execution/types.ts`
- `src/completion/guard.ts` → `src/verification/config.ts`
- `src/completion/guard.ts` → `src/completion/evidence.ts`
- `src/completion/guard.ts` → `src/completion/failures.ts`
- `src/completion/guard.ts` → `src/completion/types.ts`
- `src/completion/index.ts` → `src/completion/types.ts`
- `src/completion/index.ts` → `src/completion/config.ts`
- `src/completion/index.ts` → `src/completion/evidence.ts`
- `src/completion/index.ts` → `src/completion/failures.ts`
- `src/completion/index.ts` → `src/completion/guard.ts`
- `src/completion/index.ts` → `src/completion/tools.ts`
- `src/completion/tools.ts` → `src/tools/types.ts`
- `src/completion/tools.ts` → `src/tools/framework.ts`
- `src/completion/tools.ts` → `src/completion/evidence.ts`
- `src/completion/tools.ts` → `src/completion/guard.ts`
- `src/completion/tools.ts` → `src/completion/types.ts`
- `src/completion/types.ts` → `src/execution/types.ts`
- `src/execution/evidence.ts` → `src/execution/types.ts`
- `src/execution/index.ts` → `src/execution/types.ts`
- `src/execution/index.ts` → `src/execution/permissions.ts`
- `src/execution/index.ts` → `src/execution/logs.ts`
- `src/execution/index.ts` → `src/execution/evidence.ts`
- `src/execution/index.ts` → `src/execution/normalize.ts`
- `src/execution/index.ts` → `src/execution/service.ts`
- `src/execution/normalize.ts` → `src/execution/types.ts`
- `src/execution/permissions.ts` → `src/execution/types.ts`
- `src/execution/service.ts` → `src/execution/evidence.ts`
- `src/execution/service.ts` → `src/execution/logs.ts`
- `src/execution/service.ts` → `src/execution/normalize.ts`
- `src/execution/service.ts` → `src/execution/permissions.ts`
- `src/execution/service.ts` → `src/execution/types.ts`
- `src/extension.ts` → `src/shared/messages.ts`
- `src/extension.ts` → `src/shared/logger.ts`
- `src/extension.ts` → `src/model/profiles.ts`
- `src/extension.ts` → `src/model/registry.ts`
- `src/extension.ts` → `src/model/types.ts`
- `src/extension.ts` → `src/model/backend.ts`
- `src/extension.ts` → `src/intelligence/indexer.ts`
- `src/extension.ts` → `src/settings/configuration.ts`
- `src/extension.ts` → `src/settings/panel.ts`
- `src/extension.ts` → `src/tools/index.ts`
- `src/model/anthropic.ts` → `src/model/types.ts`
- `src/model/anthropic.ts` → `src/model/backend.ts`
- `src/model/backend.ts` → `src/model/types.ts`
- `src/model/ollama.ts` → `src/model/types.ts`
- `src/model/ollama.ts` → `src/model/backend.ts`
- `src/model/openai.ts` → `src/model/types.ts`
- `src/model/openai.ts` → `src/model/backend.ts`
- `src/model/profiles.ts` → `src/model/backend.ts`
- `src/model/profiles.ts` → `src/model/anthropic.ts`
- `src/model/profiles.ts` → `src/model/ollama.ts`
- `src/model/profiles.ts` → `src/model/openai.ts`
- `src/model/registry.ts` → `src/model/backend.ts`
- `src/model/registry.ts` → `src/model/profiles.ts`
- `src/settings/configuration.ts` → `src/settings/defaults.ts`
- `src/settings/configuration.ts` → `src/settings/registry.ts`
- `src/settings/configuration.ts` → `src/verification/config.ts`
- `src/settings/configuration.ts` → `src/completion/config.ts`
- `src/settings/defaults.ts` → `src/settings/registry.ts`
- `src/settings/panel.ts` → `src/model/profiles.ts`
- `src/settings/panel.ts` → `src/settings/configuration.ts`
- `src/shared/messages.ts` → `src/completion/types.ts`
- `src/tools/framework.ts` → `src/tools/schema.ts`
- `src/tools/framework.ts` → `src/tools/types.ts`
- `src/tools/git.ts` → `src/tools/framework.ts`
- `src/tools/git.ts` → `src/tools/types.ts`
- `src/tools/index.ts` → `src/tools/types.ts`
- `src/tools/index.ts` → `src/tools/schema.ts`
- `src/tools/index.ts` → `src/tools/framework.ts`
- `src/tools/index.ts` → `src/tools/repository.ts`
- `src/tools/index.ts` → `src/tools/loop.ts`
- `src/tools/index.ts` → `src/tools/git.ts`
- `src/tools/index.ts` → `src/tools/workspace.ts`
- `src/tools/index.ts` → `src/execution/index.ts`
- `src/tools/index.ts` → `src/verification/index.ts`
- `src/tools/index.ts` → `src/completion/index.ts`
- `src/tools/loop.ts` → `src/model/backend.ts`
- `src/tools/loop.ts` → `src/model/types.ts`
- `src/tools/loop.ts` → `src/tools/framework.ts`
- `src/tools/loop.ts` → `src/tools/types.ts`
- `src/tools/loop.ts` → `src/completion/index.ts`
- `src/tools/repository.ts` → `src/intelligence/indexer.ts`
- `src/tools/repository.ts` → `src/tools/framework.ts`
- `src/tools/repository.ts` → `src/tools/types.ts`
- `src/tools/schema.ts` → `src/tools/types.ts`
- `src/tools/workspace.ts` → `src/tools/git.ts`
- `src/tools/workspace.ts` → `src/tools/repository.ts`
- `src/tools/workspace.ts` → `src/tools/framework.ts`
- `src/tools/workspace.ts` → `src/verification/index.ts`
- `src/tools/workspace.ts` → `src/execution/index.ts`
- `src/tools/workspace.ts` → `src/completion/index.ts`
- `src/verification/config.ts` → `src/execution/types.ts`
- `src/verification/config.ts` → `src/completion/config.ts`
- `src/verification/config.ts` → `src/completion/types.ts`
- `src/verification/index.ts` → `src/verification/config.ts`
- `src/verification/index.ts` → `src/verification/runner.ts`
- `src/verification/index.ts` → `src/verification/tools.ts`
- `src/verification/runner.ts` → `src/execution/index.ts`
- `src/verification/runner.ts` → `src/execution/types.ts`
- `src/verification/runner.ts` → `src/completion/failures.ts`
- `src/verification/runner.ts` → `src/verification/config.ts`
- `src/verification/tools.ts` → `src/tools/framework.ts`
- `src/verification/tools.ts` → `src/tools/types.ts`
- `src/verification/tools.ts` → `src/execution/logs.ts`
- `src/verification/tools.ts` → `src/verification/config.ts`
- `src/verification/tools.ts` → `src/verification/runner.ts`
- `src/webview/main.ts` → `src/webview/styles.css`
- `src/webview/main.ts` → `src/shared/messages.ts`
- `test/completion.test.ts` → `src/tools/index.ts`
- `test/completion.test.ts` → `src/model/types.ts`
- `test/completion.test.ts` → `src/intelligence/indexer.ts`
- `test/execution.test.ts` → `src/tools/index.ts`
- `test/git.test.ts` → `src/tools/index.ts`
- `test/indexer.test.ts` → `src/intelligence/indexer.ts`
- `test/messages.test.ts` → `src/shared/messages.ts`

## Reverse dependencies

- `src/completion/config.ts` ← `src/completion/index.ts`, `src/settings/configuration.ts`, `src/verification/config.ts`
- `src/completion/evidence.ts` ← `src/completion/guard.ts`, `src/completion/index.ts`, `src/completion/tools.ts`
- `src/completion/failures.ts` ← `src/completion/guard.ts`, `src/completion/index.ts`, `src/verification/runner.ts`
- `src/completion/guard.ts` ← `src/completion/index.ts`, `src/completion/tools.ts`
- `src/completion/index.ts` ← `src/tools/index.ts`, `src/tools/loop.ts`, `src/tools/workspace.ts`
- `src/completion/tools.ts` ← `src/completion/index.ts`
- `src/completion/types.ts` ← `src/completion/config.ts`, `src/completion/evidence.ts`, `src/completion/failures.ts`, `src/completion/guard.ts`, `src/completion/index.ts`, `src/completion/tools.ts`, `src/shared/messages.ts`, `src/verification/config.ts`
- `src/execution/evidence.ts` ← `src/execution/index.ts`, `src/execution/service.ts`
- `src/execution/index.ts` ← `src/tools/index.ts`, `src/tools/workspace.ts`, `src/verification/runner.ts`
- `src/execution/logs.ts` ← `src/execution/index.ts`, `src/execution/service.ts`, `src/verification/tools.ts`
- `src/execution/normalize.ts` ← `src/execution/index.ts`, `src/execution/service.ts`
- `src/execution/permissions.ts` ← `src/execution/index.ts`, `src/execution/service.ts`
- `src/execution/service.ts` ← `src/execution/index.ts`
- `src/execution/types.ts` ← `src/completion/failures.ts`, `src/completion/guard.ts`, `src/completion/types.ts`, `src/execution/evidence.ts`, `src/execution/index.ts`, `src/execution/normalize.ts`, `src/execution/permissions.ts`, `src/execution/service.ts`, `src/verification/config.ts`, `src/verification/runner.ts`
- `src/intelligence/indexer.ts` ← `src/completion/guard.ts`, `src/extension.ts`, `src/tools/repository.ts`, `test/completion.test.ts`, `test/indexer.test.ts`
- `src/model/anthropic.ts` ← `src/model/profiles.ts`
- `src/model/backend.ts` ← `src/extension.ts`, `src/model/anthropic.ts`, `src/model/ollama.ts`, `src/model/openai.ts`, `src/model/profiles.ts`, `src/model/registry.ts`, `src/tools/loop.ts`, `test/stream.test.ts`
- `src/model/ollama.ts` ← `src/model/profiles.ts`
- `src/model/openai.ts` ← `src/model/profiles.ts`
- `src/model/profiles.ts` ← `src/extension.ts`, `src/model/registry.ts`, `src/settings/panel.ts`, `test/settings.test.ts`
- `src/model/registry.ts` ← `src/extension.ts`, `test/settings.test.ts`
- `src/model/types.ts` ← `src/extension.ts`, `src/model/anthropic.ts`, `src/model/backend.ts`, `src/model/ollama.ts`, `src/model/openai.ts`, `src/tools/loop.ts`, `test/completion.test.ts`, `test/tools.test.ts`
- `src/settings/configuration.ts` ← `src/extension.ts`, `src/settings/panel.ts`, `test/settings.test.ts`
- `src/settings/defaults.ts` ← `src/settings/configuration.ts`, `test/settings.test.ts`
- `src/settings/panel.ts` ← `src/extension.ts`
- `src/settings/registry.ts` ← `src/settings/configuration.ts`, `src/settings/defaults.ts`, `test/settings.test.ts`
- `src/shared/logger.ts` ← `src/extension.ts`
- `src/shared/messages.ts` ← `src/extension.ts`, `src/webview/main.ts`, `test/messages.test.ts`
- `src/tools/framework.ts` ← `src/completion/tools.ts`, `src/tools/git.ts`, `src/tools/index.ts`, `src/tools/loop.ts`, `src/tools/repository.ts`, `src/tools/workspace.ts`, `src/verification/tools.ts`
- `src/tools/git.ts` ← `src/tools/index.ts`, `src/tools/workspace.ts`
- `src/tools/index.ts` ← `src/extension.ts`, `test/completion.test.ts`, `test/execution.test.ts`, `test/git.test.ts`, `test/tools.test.ts`
- `src/tools/loop.ts` ← `src/tools/index.ts`
- `src/tools/repository.ts` ← `src/tools/index.ts`, `src/tools/workspace.ts`
- `src/tools/schema.ts` ← `src/tools/framework.ts`, `src/tools/index.ts`
- `src/tools/types.ts` ← `src/completion/tools.ts`, `src/tools/framework.ts`, `src/tools/git.ts`, `src/tools/index.ts`, `src/tools/loop.ts`, `src/tools/repository.ts`, `src/tools/schema.ts`, `src/verification/tools.ts`
- `src/tools/workspace.ts` ← `src/tools/index.ts`
- `src/verification/config.ts` ← `src/completion/guard.ts`, `src/settings/configuration.ts`, `src/verification/index.ts`, `src/verification/runner.ts`, `src/verification/tools.ts`
- `src/verification/index.ts` ← `src/tools/index.ts`, `src/tools/workspace.ts`
- `src/verification/runner.ts` ← `src/verification/index.ts`, `src/verification/tools.ts`
- `src/verification/tools.ts` ← `src/verification/index.ts`
- `src/webview/styles.css` ← `src/webview/main.ts`

## Dependencies

- `@types/node`: ^22.0.0
- `@types/vscode`: ^1.85.0
- `@typescript-eslint/eslint-plugin`: ^8.0.0
- `@typescript-eslint/parser`: ^8.0.0
- `esbuild`: ^0.24.0
- `eslint`: ^9.0.0
- `typescript`: ^5.6.0
- `typescript-eslint`: ^8.0.0
- `vitest`: ^2.1.0
- `yaml`: ^2.9.0

## Incremental update

- Reused: 0
- Added: 62
- Changed: 0
- Removed: 0
- Renamed: 0

Rebuild with **LGS: Rebuild Repository Index**.
