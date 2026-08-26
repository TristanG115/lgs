# LGS (Little Grad Student)

LGS is a VS Code extension for reliable software-engineering agents. Phase 8 adds controlled, evidence-producing software verification on top of provider-neutral model backends, deterministic Repository Intelligence, and guarded workspace tools.

## Repository structure

- `src/extension.ts` — extension-host activation, command, and `WebviewViewProvider`.
- `src/webview/` — browser-side UI and styles.
- `src/intelligence/indexer.ts` — deterministic filesystem/source indexer and codebase-map generator.
- `src/tools/` — typed tool contracts, validation, guarded execution, repository/Git tools, task baselines, audit records, and the model continuation loop.
- `src/execution/` — structured process execution, command permissions, normalized output, raw logs, and persisted task evidence.
- `src/verification/` — generic project verification configuration, targeted selection, and model-facing verification tools.
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

Phase 3 maintains deterministic repository intelligence in `.lgs/`. Run **LGS: Rebuild Repository Index** to update file fingerprints, parse TypeScript/JavaScript imports, exports, and top-level symbols, collect manifests and dependencies, and regenerate both artifacts. The index is hierarchical (`repository → module → directory → file → symbol`) and also records local relationships, reverse dependencies, likely tests/documentation, and important entry points.

Index updates reuse unchanged file entries and record added, changed, deleted, and hash-matched renamed files. The scanner respects `.gitignore` and excludes dependency, build, cache, `.git`, and generated `.lgs` directories. **LGS: Open Codebase Map** checks freshness and warns when the generated map needs rebuilding. The map is intentionally compact and does not reproduce source code.

## Read-only workspace tools

Phase 4 exposes `list_directory`, `read_file`, `read_file_range`, `search_workspace`, `find_symbol`, `find_references`, `get_file_summary`, `get_codebase_map_section`, `get_project_dependencies`, `get_related_tests`, and `get_related_files`. Metadata and relationship tools consult Repository Intelligence; content tools access the filesystem only after resolving and verifying a workspace-relative path.

Each tool definition includes an ID, description, JSON-like argument schema, optional semantic validation, execution function, and explicit permission metadata (`read-only`, `workspace`, no network). `ToolExecutor` treats every model call as untrusted: the call envelope and all arguments are validated before dispatch, unknown properties are rejected, structured failures are normalized, cancellation is propagated, and a framework-level byte limit bounds even an incorrectly implemented tool.

File reads default to 200 lines and allow at most 400 lines per request. Listings, searches, symbols, references, dependencies, and relationship queries are paginated. Results report byte and item counts, truncation, their intelligence/filesystem source, and an opaque continuation token when another page is available. Automatically selected related files include a short relevance reason.

All repository tools reject absolute paths, `..` traversal, workspace escape, and symlinks whose resolved target leaves the workspace. Binary reads and malformed or mismatched continuation tokens produce structured errors. Tool audits include task/session and agent/model identity when known, redacted arguments, permission, status, duration, and bounded result metadata; the extension writes these records to the LGS output logger without API keys, authorization values, tokens, cookies, or passwords.

The continuation lifecycle is model → tool-call envelope → schema validation → guarded execution → structured tool result → model. `runToolLoop` caps turns and total calls, and `BackendToolLoopModel` makes this loop available consistently across the existing OpenAI-compatible, Anthropic, and Ollama backends. Pressing Stop aborts both model generation and tool execution.

## Git intelligence

Phase 5 adds `git_status`, `git_diff`, `git_file_history`, `git_show_commit`, `git_blame_range`, and `git_log_search`. Recent file history and log searches return compact commit, date, and summary records first. Older history uses continuation tokens; commit patches and blame ranges are returned only when explicitly requested. Diffs and patches are line-paginated and byte-bounded.

Before the first model turn in a chat task, `GitBaselineStore` captures the branch, HEAD, staged changes, unstaged changes, and all untracked files. Each dirty entry also receives a content or patch fingerprint. The baseline is retained for the task and persisted in VS Code global extension state, so later `git_status` calls can distinguish unchanged preexisting user work, later edits to an already-dirty path, newly introduced changes, and preexisting changes that are no longer present.

Git execution uses `execFile` with argument arrays and an allowlist of read-only commands; no model input is interpolated into a shell command. Pagers, terminal prompts, optional index locks, external diffs, and text-conversion filters are disabled where applicable. User paths must remain workspace-relative, revisions are restricted to hexadecimal commit IDs, and nested workspaces scope status and history to their own paths. Git commands never stage, commit, reset, checkout, or otherwise mutate repository state.

Workspaces outside a Git repository remain fully usable. `git_status` reports that Git is unavailable for that workspace, while history-specific requests return a structured `unsupported` result. The model guidance asks agents to inspect recent history for code relevant to a material behavior change without automatically loading history for every file.

## Settings and configuration

LGS Settings is a dedicated webview opened with **LGS: Open Settings** or the gear button in the chat. Settings are registered through `SettingsRegistry` definitions containing an ID, category, label, description, type, default, scope, validation, and optional visibility condition. Future subsystems should register definitions instead of adding monolithic page logic.

Configuration precedence is built-in default → user setting → workspace setting. User values are stored in VS Code extension global state. Workspace values are stored in `.lgs/config.yaml` under `settings:` and override user values. Malformed workspace YAML is reported in the Settings page and falls back safely.

Provider connections are independent profiles, so multiple OpenAI-compatible endpoints can coexist. Profiles support enablement, ordinary headers, secret custom headers, model aliases, capability overrides, connection testing, and model discovery. API keys and secret header values remain in VS Code SecretStorage; the Settings webview receives only metadata such as whether a secret exists.

The General, Appearance, Models & Providers, Agents, Integrations, Context, Verification, Git, Usage & Budgets, Memory, Skills, Permissions, and Advanced sections are navigable. Unimplemented sections show explicit placeholders rather than nonfunctional controls. Appearance supports Follow VS Code plus initial LGS light and dark semantic palettes.

## Controlled command execution

Phase 8 gives agents a `run_verification` tool backed by structured command definitions. A request carries an executable, an argument array, a workspace-relative working directory, explicit environment overrides, a command category, and a bounded timeout. LGS launches the executable directly with shell mode disabled, inherits only a small operational environment allowlist, rejects working-directory escape and malformed values, and propagates cancellation from the chat Stop action.

Command policy is resolved at executable, category, and default levels with workspace values taking precedence over user values. The supported policies are `always_allow`, `ask`, and `deny`; categories are `read-only`, `build`, `test`, `package-manager`, `git-mutation`, `network`, `process`, and `dangerous`. The composer approval setting supplies the fallback policy, while `.lgs/config.yaml` can set workspace-specific rules under `permissions.commands`. Commands with an `ask` result use a modal VS Code approval prompt before any process starts.

Model-facing execution results contain the exact display command, status and exit code, a primary error, relevant stack lines, important file locations, and short stdout/stderr previews. Full logs are retained under `.lgs/logs/` and are available only through explicitly paged `get_execution_log` calls. Every task-associated execution is appended to `.lgs/tasks/<task-id>/evidence.json`; both runtime directories are ignored by Git and Repository Intelligence.

## Verification configuration

Project verification is package-manager-neutral. Each `.lgs/config.yaml` entry is an object with `executable`, `args`, and `category`, plus optional `cwd`, `env`, `timeoutMs`, and `include`. The supported keys are `install`, `typecheck`, `lint`, `targetedTest`, `test`, `build`, and `start`; a key can contain one command or a sequence. LGS does not infer npm, Cargo, Gradle, pytest, or another tool—the repository supplies the appropriate executable and argument array.

`targetedTest` definitions may use `include` globs to associate changed workspace paths with a command. The literal `{targets}` argument expands into separate, non-shell arguments, allowing a change such as `test/auth.test.ts` to run only its related verification command. During development agents are instructed to use targeted verification; full configured gates are reserved for the completion check in Phase 9.

Example:

```yaml
verification:
  typecheck:
    executable: cargo
    args: [check]
    category: build
  targetedTest:
    executable: pytest
    args: ["{targets}"]
    category: test
    include: ["tests/auth/**"]
permissions:
  commands:
    default: ask
    categories:
      test: always_allow
      dangerous: deny
```
