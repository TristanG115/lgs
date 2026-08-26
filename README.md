# LGS (Little Grad Student)

LGS is a VS Code extension that will eventually orchestrate reliable software-engineering agents. Phase 1 adds provider-neutral model backends and real streaming chat. It intentionally does not add agent tools.

## Repository structure

- `src/extension.ts` — extension-host activation, command, and `WebviewViewProvider`.
- `src/webview/` — browser-side UI and styles.
- `src/intelligence/indexer.ts` — deterministic filesystem/source indexer and codebase-map generator.
- `.lgs/index.json` — generated machine-readable repository index.
- `.lgs/CODEBASE_MAP.md` — generated compact architecture guide.
- `src/shared/messages.ts` — typed message contracts and runtime validation shared by both sides.
- `src/shared/logger.ts` — small extension logging abstraction.
- `test/` — Vitest tests for shared utilities.
- `esbuild.mjs` — extension and webview build entry points.

## Installation and development

Install dependencies with `npm install`, then use `npm run build` for a production build. `npm run dev` watches both entry points. Quality checks are `npm run typecheck`, `npm run lint`, and `npm test`.

To launch the extension, open this repository in VS Code and press `F5`. This opens an Extension Development Host. Select the LGS activity-bar icon, enter a message, and press **Send**.

## Model backend architecture

`ModelBackend` exposes backend identity, connection state, capabilities, model discovery, cancellable streaming chat, normalized usage, and structured errors. `LgsMessage` contains a role and an array of text or image content parts. Stream output is represented by `StreamEvent` values (`textDelta`, `usage`, `done`, and `error`).

The lifecycle is: construct a backend, discover models, select a model, call `streamChat` with an `AbortSignal`, consume events, and abort when the user presses Stop. Ollama uses its native NDJSON API; `OpenAICompatibleBackend` uses `/models` and `/chat/completions`, supporting LM Studio, llama.cpp, vLLM, and similar servers; `AnthropicBackend` uses the Messages API. Provider-specific wire schemas are confined to `src/model/`.

API secrets are retrieved from VS Code `SecretStorage`. They are never placed in settings, project files, logs, or chat history. To add a provider, implement `ModelBackend`, translate its protocol into normalized `ModelInfo` and `StreamEvent` values, and register it in `src/model/registry.ts`.

## Communication architecture

The compact LGS webview has a compact header, chat history list, centered empty state, and bottom composer. The backend profile, discovered model, thinking level, and approval level are selected from the composer. VS Code theme tokens (`--vscode-*`) provide colors, typography, borders, and controls, so the UI follows the active light, dark, or high-contrast theme.

Chat history is persisted in VS Code global extension state (up to 100 conversations) and is sent back to the selected model as normalized message history. API keys are never persisted with chats.

The webview posts only the `ClientMessage` union. The extension host receives `unknown`, validates it with `parseClientMessage`, and responds only with the `HostMessage` union. The webview validates incoming events with `isHostMessage` before rendering them. Provider profiles are managed by `LgsViewProvider` and `SettingsPanel`; adding a provider means implementing `ModelBackend` and adding a `ProviderKind` mapping in `src/model/profiles.ts`. Approval levels are UI policy state for the future tool-execution phase; Phase 1 has no agent tools to approve.

## Repository intelligence

Phase 2 maintains deterministic repository intelligence in `.lgs/`. Run **LGS: Rebuild Repository Index** to scan the workspace, update file fingerprints, parse TypeScript/JavaScript imports, exports, and top-level symbols, collect manifests and dependencies, and regenerate both artifacts. Unchanged files are reused from the prior index; added, changed, removed, and hash-matched renamed files are tracked in the incremental summary. Dependency, build, cache, `.git`, and `.lgs` directories are ignored.

Use **LGS: Open Codebase Map** to open the generated architecture guide in VS Code. The map is intentionally compact and does not reproduce source code.

## Settings and configuration

LGS Settings is a dedicated webview opened with **LGS: Open Settings** or the gear button in the chat. Settings are registered through `SettingsRegistry` definitions containing an ID, category, label, description, type, default, scope, validation, and optional visibility condition. Future subsystems should register definitions instead of adding monolithic page logic.

Configuration precedence is built-in default → user setting → workspace setting. User values are stored in VS Code extension global state. Workspace values are stored in `.lgs/config.yaml` under `settings:` and override user values. Malformed workspace YAML is reported in the Settings page and falls back safely.

Provider connections are independent profiles, so multiple OpenAI-compatible endpoints can coexist. Profiles support enablement, ordinary headers, secret custom headers, model aliases, capability overrides, connection testing, and model discovery. API keys and secret header values remain in VS Code SecretStorage; the Settings webview receives only metadata such as whether a secret exists.

The General, Appearance, Models & Providers, Agents, Integrations, Context, Verification, Git, Usage & Budgets, Memory, Skills, Permissions, and Advanced sections are navigable. Unimplemented sections show explicit placeholders rather than nonfunctional controls. Appearance supports Follow VS Code plus initial LGS light and dark semantic palettes.
