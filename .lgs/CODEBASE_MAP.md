# LGS Codebase Map

Generated: 2026-08-26T09:48:40.605Z

This map is generated deterministically from the filesystem, manifests, and source syntax. Source files remain authoritative.

## Freshness

- Index: current
- Codebase Map: current
- Stale entries: none

## Repository shape

- Files: 54
- Directories: 12
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
- Files: 36; directories: 9
- Entry points: `src/extension.ts`
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
  - `src/tools/git.ts` — TypeScript
    - Symbols: GIT_COMMANDS, MAX_GIT_BUFFER, MAX_DIFF_LINES, MAX_HISTORY_PAGE, DEFAULT_HISTORY_PAGE, MAX_BLAME_LINES, MAX_TOKEN_LENGTH, GitChange, GitBaseline, GitCommandResult, GitCommandRunner, GitCommandError
  - `src/tools/index.ts` — TypeScript
  - `src/tools/loop.ts` — TypeScript
    - Symbols: ToolModelTurn, ToolLoopModel, ToolLoopOutcome, runToolLoop, BackendToolLoopModel, parseModelTurn, toolInstructions
  - `src/tools/repository.ts` — TypeScript
    - Symbols: MAX_READ_LINES, DEFAULT_READ_LINES, MAX_CONTENT_BYTES, MAX_SEARCH_RESULTS, MAX_INDEX_RESULTS, MAX_SEARCH_FILE_BYTES, MAX_TOKEN_LENGTH, PathArgs, PageArgs, pathProperty, pageProperties, createRepositoryToolRegistry
  - `src/tools/schema.ts` — TypeScript
    - Symbols: ValidationIssue, validateSchema, isPlainObject
  - `src/tools/types.ts` — TypeScript
    - Symbols: JsonSchema, ToolPermission, ToolErrorCode, ToolError, ToolResultMetadata, ToolResult, ToolIdentity, ToolAuditRecord, ToolAuditSink, ToolExecutionContext, ToolExecutionOutput, ToolDefinition
  - `src/tools/workspace.ts` — TypeScript
    - Symbols: createWorkspaceToolRegistry

### test
- Path: test
- Files: 7; directories: 1
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
- `src/settings/defaults.ts` → `src/settings/registry.ts`
- `src/settings/panel.ts` → `src/model/profiles.ts`
- `src/settings/panel.ts` → `src/settings/configuration.ts`
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
- `src/tools/loop.ts` → `src/model/backend.ts`
- `src/tools/loop.ts` → `src/model/types.ts`
- `src/tools/loop.ts` → `src/tools/framework.ts`
- `src/tools/loop.ts` → `src/tools/types.ts`
- `src/tools/repository.ts` → `src/intelligence/indexer.ts`
- `src/tools/repository.ts` → `src/tools/framework.ts`
- `src/tools/repository.ts` → `src/tools/types.ts`
- `src/tools/schema.ts` → `src/tools/types.ts`
- `src/tools/workspace.ts` → `src/tools/git.ts`
- `src/tools/workspace.ts` → `src/tools/repository.ts`
- `src/tools/workspace.ts` → `src/tools/framework.ts`
- `src/tools/workspace.ts` → `src/verification/index.ts`
- `src/tools/workspace.ts` → `src/execution/index.ts`
- `src/verification/config.ts` → `src/execution/types.ts`
- `src/verification/index.ts` → `src/verification/config.ts`
- `src/verification/index.ts` → `src/verification/runner.ts`
- `src/verification/index.ts` → `src/verification/tools.ts`
- `src/verification/runner.ts` → `src/execution/index.ts`
- `src/verification/runner.ts` → `src/execution/types.ts`
- `src/verification/runner.ts` → `src/verification/config.ts`
- `src/verification/tools.ts` → `src/tools/framework.ts`
- `src/verification/tools.ts` → `src/tools/types.ts`
- `src/verification/tools.ts` → `src/execution/logs.ts`
- `src/verification/tools.ts` → `src/verification/config.ts`
- `src/verification/tools.ts` → `src/verification/runner.ts`
- `src/webview/main.ts` → `src/webview/styles.css`
- `src/webview/main.ts` → `src/shared/messages.ts`
- `test/execution.test.ts` → `src/tools/index.ts`
- `test/git.test.ts` → `src/tools/index.ts`
- `test/indexer.test.ts` → `src/intelligence/indexer.ts`
- `test/messages.test.ts` → `src/shared/messages.ts`
- `test/settings.test.ts` → `src/settings/defaults.ts`
- `test/settings.test.ts` → `src/settings/registry.ts`
- `test/settings.test.ts` → `src/settings/configuration.ts`
- `test/settings.test.ts` → `src/model/registry.ts`
- `test/settings.test.ts` → `src/model/profiles.ts`
- `test/stream.test.ts` → `src/model/backend.ts`
- `test/tools.test.ts` → `src/tools/index.ts`
- `test/tools.test.ts` → `src/model/types.ts`

## Reverse dependencies

- `src/execution/evidence.ts` ← `src/execution/index.ts`, `src/execution/service.ts`
- `src/execution/index.ts` ← `src/tools/index.ts`, `src/tools/workspace.ts`, `src/verification/runner.ts`
- `src/execution/logs.ts` ← `src/execution/index.ts`, `src/execution/service.ts`, `src/verification/tools.ts`
- `src/execution/normalize.ts` ← `src/execution/index.ts`, `src/execution/service.ts`
- `src/execution/permissions.ts` ← `src/execution/index.ts`, `src/execution/service.ts`
- `src/execution/service.ts` ← `src/execution/index.ts`
- `src/execution/types.ts` ← `src/execution/evidence.ts`, `src/execution/index.ts`, `src/execution/normalize.ts`, `src/execution/permissions.ts`, `src/execution/service.ts`, `src/verification/config.ts`, `src/verification/runner.ts`
- `src/intelligence/indexer.ts` ← `src/extension.ts`, `src/tools/repository.ts`, `test/indexer.test.ts`
- `src/model/anthropic.ts` ← `src/model/profiles.ts`
- `src/model/backend.ts` ← `src/extension.ts`, `src/model/anthropic.ts`, `src/model/ollama.ts`, `src/model/openai.ts`, `src/model/profiles.ts`, `src/model/registry.ts`, `src/tools/loop.ts`, `test/stream.test.ts`
- `src/model/ollama.ts` ← `src/model/profiles.ts`
- `src/model/openai.ts` ← `src/model/profiles.ts`
- `src/model/profiles.ts` ← `src/extension.ts`, `src/model/registry.ts`, `src/settings/panel.ts`, `test/settings.test.ts`
- `src/model/registry.ts` ← `src/extension.ts`, `test/settings.test.ts`
- `src/model/types.ts` ← `src/extension.ts`, `src/model/anthropic.ts`, `src/model/backend.ts`, `src/model/ollama.ts`, `src/model/openai.ts`, `src/tools/loop.ts`, `test/tools.test.ts`
- `src/settings/configuration.ts` ← `src/extension.ts`, `src/settings/panel.ts`, `test/settings.test.ts`
- `src/settings/defaults.ts` ← `src/settings/configuration.ts`, `test/settings.test.ts`
- `src/settings/panel.ts` ← `src/extension.ts`
- `src/settings/registry.ts` ← `src/settings/configuration.ts`, `src/settings/defaults.ts`, `test/settings.test.ts`
- `src/shared/logger.ts` ← `src/extension.ts`
- `src/shared/messages.ts` ← `src/extension.ts`, `src/webview/main.ts`, `test/messages.test.ts`
- `src/tools/framework.ts` ← `src/tools/git.ts`, `src/tools/index.ts`, `src/tools/loop.ts`, `src/tools/repository.ts`, `src/tools/workspace.ts`, `src/verification/tools.ts`
- `src/tools/git.ts` ← `src/tools/index.ts`, `src/tools/workspace.ts`
- `src/tools/index.ts` ← `src/extension.ts`, `test/execution.test.ts`, `test/git.test.ts`, `test/tools.test.ts`
- `src/tools/loop.ts` ← `src/tools/index.ts`
- `src/tools/repository.ts` ← `src/tools/index.ts`, `src/tools/workspace.ts`
- `src/tools/schema.ts` ← `src/tools/framework.ts`, `src/tools/index.ts`
- `src/tools/types.ts` ← `src/tools/framework.ts`, `src/tools/git.ts`, `src/tools/index.ts`, `src/tools/loop.ts`, `src/tools/repository.ts`, `src/tools/schema.ts`, `src/verification/tools.ts`
- `src/tools/workspace.ts` ← `src/tools/index.ts`
- `src/verification/config.ts` ← `src/settings/configuration.ts`, `src/verification/index.ts`, `src/verification/runner.ts`, `src/verification/tools.ts`
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

- Reused: 50
- Added: 0
- Changed: 4
- Removed: 0
- Renamed: 0

Rebuild with **LGS: Rebuild Repository Index**.
