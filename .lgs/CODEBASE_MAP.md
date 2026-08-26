# LGS Codebase Map

Generated: 2026-08-26T02:55:10.685Z

This map is generated deterministically from the filesystem, manifests, and source syntax. Source files remain authoritative.

## Freshness

- Index: current
- Codebase Map: current
- Stale entries: none

## Repository shape

- Files: 32
- Directories: 9
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
- Files: 17; directories: 6
- Entry points: `src/extension.ts`
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
    - Symbols: WorkspaceConfiguration, SettingsManager
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
  - `src/webview/main.ts` — TypeScript
    - Symbols: acquireVsCodeApi, vscode, app, generating, currentAssistant, history, input, send, stop, state, profile, model, thinking, approval, chats, syncOptions, add
  - `src/webview/styles.css` — CSS

### test
- Path: test
- Files: 4; directories: 1
  - `test/indexer.test.ts` — TypeScript (test)
    - Symbols: fixture, cleanup
  - `test/messages.test.ts` — TypeScript (test)
  - `test/settings.test.ts` — TypeScript (test)
    - Symbols: context
  - `test/stream.test.ts` — TypeScript (test)

## Relationships

- `src/extension.ts` → `src/shared/messages.ts`
- `src/extension.ts` → `src/shared/logger.ts`
- `src/extension.ts` → `src/model/profiles.ts`
- `src/extension.ts` → `src/model/registry.ts`
- `src/extension.ts` → `src/model/types.ts`
- `src/extension.ts` → `src/model/backend.ts`
- `src/extension.ts` → `src/intelligence/indexer.ts`
- `src/extension.ts` → `src/settings/configuration.ts`
- `src/extension.ts` → `src/settings/panel.ts`
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
- `src/settings/defaults.ts` → `src/settings/registry.ts`
- `src/settings/panel.ts` → `src/model/profiles.ts`
- `src/settings/panel.ts` → `src/settings/configuration.ts`
- `src/webview/main.ts` → `src/webview/styles.css`
- `src/webview/main.ts` → `src/shared/messages.ts`
- `test/indexer.test.ts` → `src/intelligence/indexer.ts`
- `test/messages.test.ts` → `src/shared/messages.ts`
- `test/settings.test.ts` → `src/settings/defaults.ts`
- `test/settings.test.ts` → `src/settings/registry.ts`
- `test/settings.test.ts` → `src/settings/configuration.ts`
- `test/settings.test.ts` → `src/model/registry.ts`
- `test/settings.test.ts` → `src/model/profiles.ts`
- `test/stream.test.ts` → `src/model/backend.ts`

## Reverse dependencies

- `src/intelligence/indexer.ts` ← `src/extension.ts`, `test/indexer.test.ts`
- `src/model/anthropic.ts` ← `src/model/profiles.ts`
- `src/model/backend.ts` ← `src/extension.ts`, `src/model/anthropic.ts`, `src/model/ollama.ts`, `src/model/openai.ts`, `src/model/profiles.ts`, `src/model/registry.ts`, `test/stream.test.ts`
- `src/model/ollama.ts` ← `src/model/profiles.ts`
- `src/model/openai.ts` ← `src/model/profiles.ts`
- `src/model/profiles.ts` ← `src/extension.ts`, `src/model/registry.ts`, `src/settings/panel.ts`, `test/settings.test.ts`
- `src/model/registry.ts` ← `src/extension.ts`, `test/settings.test.ts`
- `src/model/types.ts` ← `src/extension.ts`, `src/model/anthropic.ts`, `src/model/backend.ts`, `src/model/ollama.ts`, `src/model/openai.ts`
- `src/settings/configuration.ts` ← `src/extension.ts`, `src/settings/panel.ts`, `test/settings.test.ts`
- `src/settings/defaults.ts` ← `src/settings/configuration.ts`, `test/settings.test.ts`
- `src/settings/panel.ts` ← `src/extension.ts`
- `src/settings/registry.ts` ← `src/settings/configuration.ts`, `src/settings/defaults.ts`, `test/settings.test.ts`
- `src/shared/logger.ts` ← `src/extension.ts`
- `src/shared/messages.ts` ← `src/extension.ts`, `src/webview/main.ts`, `test/messages.test.ts`
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
- Added: 32
- Changed: 0
- Removed: 0
- Renamed: 0

Rebuild with **LGS: Rebuild Repository Index**.
