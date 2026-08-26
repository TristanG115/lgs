# LGS (Little Grad Student)

LGS is a VS Code extension for reliable software-engineering agents. Phase 13 makes documentation a mechanically enforced engineering output, building on version-aware research, the read-only Watchdog, manager-and-worker orchestration, the evidence-backed Completion Guard, controlled verification, provider-neutral model backends, and deterministic Repository Intelligence.

## Repository structure

- `src/extension.ts` — extension-host activation, command, and `WebviewViewProvider`.
- `src/webview/` — browser-side UI and styles.
- `src/intelligence/indexer.ts` — deterministic filesystem/source indexer and codebase-map generator.
- `src/tools/` — typed tool contracts, validation, guarded execution, repository/Git tools, task baselines, audit records, and the model continuation loop.
- `src/execution/` — structured process execution, command permissions, normalized output, raw logs, and persisted task evidence.
- `src/verification/` — generic project verification configuration, targeted selection, and model-facing verification tools.
- `src/completion/` — completion gates, durable evidence, failure budgets, and completion-attempt enforcement.
- `src/orchestration/` — logical agent sessions, role/model routing, inference scheduling, lifecycle control, and compact worker reports.
- `src/watchdog/` — compact persistent task state, read-only progress review, continuation instructions, escalation routing, and escalation evidence.
- `src/research/` — provider-neutral research tools, manifest version discovery, concise provenance, and task-local deduplication.
- `src/documentation/` — DocumentationAgent context collection, category audits, freshness evidence, and incremental CODEBASE_MAP tools.
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

## Completion Guard

Phase 9 makes completion an LGS decision rather than a model assertion. Whenever a model returns a final response, the tool loop evaluates the configured completion gates. If any required gate lacks current evidence, LGS sends a `COMPLETION_BLOCKED` report back into the loop and requires the agent to continue. The sidebar displays the same state as a collapsible progress checklist.

Command-backed gates use persisted verification executions for targeted tests, full tests, typecheck, lint, build, and optional runtime verification. Repository Intelligence checks `.lgs/index.json` and `.lgs/CODEBASE_MAP.md` directly. The agent records file-fingerprinted evidence for implementation, relevant tests, and documentation, so later edits make that evidence stale. Acceptance-criteria and optional independent-review evidence are retained under `.lgs/tasks/<task-id>/completion-evidence.json`; runtime data remains ignored by Git.

Completion defaults require acceptance criteria, implementation, relevant tests, targeted and full test runs, typecheck, lint, build, current documentation, a current CODEBASE_MAP, and no unresolved verification failures. Runtime verification and independent review are opt-in gates. Configure gates and loop limits in `.lgs/config.yaml`:

```yaml
completion:
  gates:
    runtime_verification_passes: true
    independent_review_passes: true
  failureBudgets:
    same_error_retry_limit: 3
    total_fix_attempt_limit: 12
    escalation_threshold: 3
```

Substantially repeated errors are normalized into fingerprints so changing line numbers, IDs, or paths does not reset the retry count. When either retry limit is exhausted, LGS blocks further configured verification attempts and marks escalation as required when the escalation threshold is reached. A later passing run resolves prior failures for the same verification step, but does not erase failure-budget history.

## Manager and worker agents

Phase 10 lets the Manager delegate bounded batches through `delegate_subtasks`. The professional logical roles are Manager, Explorer, Researcher, Implementer, Test Engineer, Documentation Agent, Reviewer, Debugger, and Verifier. Each worker receives a copied, isolated message context and produces only a compact structured report containing findings, relevant files, work performed, risks, unresolved questions, and a recommendation. Raw worker transcripts are neither returned to the Manager nor exposed by agent-status tools.

Logical sessions do not create separate model installations or VRAM copies. `BackendAgentInference` caches one backend per provider connection, while every worker retains its own identity, context, cancellation controller, lifecycle state, and report. Provider connection and model name together form the inference identity. Read-only workers can share configured inference slots; write-capable workers are globally serialized. The Manager can inspect lifecycle metadata, cancel active sessions, and destroy terminal sessions. Batch delegation gathers successful reports, contains individual failures, and destroys worker sessions after returning their results.

Role mappings are workspace configuration, never hardcoded. A string selects a model on the Manager's current provider connection; an object can select both a provider profile and model:

```yaml
agents:
  readOnlyConcurrency: 2
  maxWorkersPerBatch: 6
  maxContextMessages: 30
  roleModels:
    manager:
      profileId: local-ollama
      model: gpt-oss:20b
    explorer: qwen3.5:9b
    implementer:
      profileId: workstation-ollama
      model: qwen3.5:27b
    reviewer: qwen3.5:27b
```

Unmapped roles inherit the active Manager provider connection and model. This keeps configuration portable across Ollama, OpenAI-compatible, and Anthropic profiles and permits several logical workers to share a single loaded model.

## Watchdog and automatic escalation

Phase 11 stores compact task state in `.lgs/tasks/<task-id>/state.json`, independently of whichever model is active. The objective is initialized from the original user request. Agents update acceptance criteria, the current plan, completed and remaining work, recent modifications, and explicit uncertainty through `update_task_state`. Verification failures are read directly from command evidence rather than self-reported. This state survives model escalation and is available through `get_task_state`; runtime task files remain ignored by Git and Repository Intelligence.

At the configured turn interval and every completion attempt, the lightweight Watchdog receives only the objective, acceptance criteria, plan, completed work, remaining work, recent modifications, and recent failures. It has no workspace tools and cannot edit code. It returns one structured classification: `ON_TRACK`, `OFF_TRACK`, `MISSING_REQUIREMENT`, `NEEDS_RESEARCH`, `RECONSIDER_APPROACH`, or `POTENTIAL_SCOPE_CREEP`, together with bounded evidence, an explanation, and a recommended next action. Findings are retained in `.lgs/tasks/<task-id>/watchdog.json`.

When progress stalls or completion is premature, `runToolLoop` inserts an explicit `CONTINUE_WORKING` or `COMPLETION_BLOCKED` instruction assembled from remaining Completion Guard criteria, Watchdog findings, and failed verification. Models do not need to remember to prompt themselves. Repeated failures, retry exhaustion, Reviewer rejection, invalid tool requests, unresolved criteria, explicit uncertainty, and non-`ON_TRACK` Watchdog recommendations are detected automatically.

Escalation routes are ordered `worker → manager → difficult → cloud`. Each configured transition can select a model on the current provider profile or an explicit provider-profile/model identity. `RoutedToolLoopModel` switches the inference target without replacing the task messages or LGS task state, and a restarted chat task resumes its latest recorded escalation target. A successful route transition begins a fresh bounded failure-budget segment, allowing the escalated model to verify a materially different fix without reopening an endless retry loop. Every attempted escalation—including one with no configured higher route—is recorded with its trigger, explanation, source and destination identity, task-state revision, and timestamp in `.lgs/tasks/<task-id>/escalations.json`.

```yaml
watchdog:
  intervalTurns: 3
  model:
    profileId: local-ollama
    model: qwen3.5:9b
  escalation:
    routes:
      manager: gpt-oss:20b
      difficult:
        profileId: workstation-ollama
        model: qwen3.5:27b
      cloud:
        profileId: production-anthropic
        model: configured-cloud-model
```

The Watchdog model is optional. Without one, LGS uses deterministic checks for missing requirements, explicit uncertainty, stalled progress, and substantially repeated failures. No provider or model name is hardcoded.

## Research-first external knowledge

Phase 12 exposes provider-neutral `web_search`, `web_fetch`, `documentation_search`, and `repository_search` tools. Agents are explicitly instructed to research rather than guess when external or dependency APIs are uncertain, versions matter, an error is unfamiliar, behavior may have changed since model training, the model has meaningful uncertainty, or the Manager or Watchdog requests verification. `get_research_findings` lets an agent reuse evidence already collected for the current task without loading worker transcripts or full webpages.

Before every technical research request, LGS reads local manifests and lockfiles. It recognizes npm package manifests and locks, pnpm locks, and pinned Python requirements, then enriches the query with the exact resolved dependency version when available—for example, `yaml 2.9.1 parse API behavior`. An explicit `dependency` or `relevantVersion` tool argument can disambiguate packages and other versioned APIs.

Results are normalized into concise findings and sorted by authority: official documentation, official source, official issues or maintainer discussion, authoritative technical references, high-quality community sources, then forums. Each retained finding records its source URL, title, retrieval time, relevant version, concise evidence, task, subtask, requesting agent, dependency manifests, and normalized query. LGS stores this provenance in `.lgs/tasks/<task-id>/research.json`; complete webpages are never persisted there or returned to model context. Repeated task queries reuse fresh findings, while a changed dependency version or expired freshness window forces new research.

`web_fetch` accepts public HTTP(S) pages, rejects embedded credentials and local or private-network targets, follows only revalidated public redirects, accepts text-like content, and bounds downloaded bytes before extracting relevant sentences. `repository_search` uses a configured provider when present and otherwise uses GitHub code search. Search services remain configurable rather than hardcoded:

```yaml
research:
  freshnessDays: 14
  maxResults: 6
  maxFetchBytes: 512000
  endpoints:
    webSearch: https://research-gateway.example/search
    documentationSearch: https://research-gateway.example/docs
    repositorySearch: https://research-gateway.example/source
  github:
    enabled: true
    apiBaseUrl: https://api.github.com
```

An endpoint may contain a `{query}` placeholder; otherwise LGS adds a `q` query parameter. Endpoint responses may be a JSON array or an object with a `results` or `items` array. Each item can provide `url` or `link`, `title`, a concise `snippet`, an optional `authority`, and an optional `relevantVersion`. Authentication and vendor-specific protocols belong behind the configured gateway, keeping the LGS research contract provider-neutral and preventing credentials from entering task evidence.

## Documentation as an engineering output

Phase 13 requires documentation maintenance as part of every meaningful implementation. After modifications, the Manager runs `audit_documentation`. The dedicated DocumentationAgent receives a bounded engineering context containing the objective, acceptance criteria, current Git diff, changed paths and symbols, affected repository relationships, current documentation excerpts, CODEBASE_MAP, change classifications, and persistent task state. It returns one structured assessment for every documentation category and identifies which surfaces remain stale.

The categories are user-facing, developer, architecture, configuration, API, useful inline comments, `.lgs/CODEBASE_MAP.md`, and task records. A category can be current, stale, or not applicable. Documentation guidance explicitly rejects comments that merely repeat obvious code; inline comments are appropriate only when they explain non-obvious constraints, decisions, or behavior.

The latest audit is stored under `.lgs/tasks/<task-id>/documentation-audit.json`. Its evidence fingerprints the complete indexed workspace, CODEBASE_MAP, and task-state revision before analysis. A later code, test, manifest, documentation, map, or task-state edit invalidates the audit mechanically. `get_documentation_state` exposes the current audit and freshness result without rerunning model inference.

Completion Guard uses the DocumentationAgent audit for the `documentation_current` gate. Completion is blocked when no post-change audit exists, the audit fingerprint is stale, or any affected category remains stale. The CODEBASE_MAP category is always overridden by deterministic Repository Intelligence freshness rather than model judgment, while the existing `codebase_map_current` completion gate remains an independent check.

Agents use `update_codebase_map` after file creation, deletion, rename, responsibility changes, dependency or interface changes, major test changes, and architectural changes. The tool passes the previous Repository Index into the deterministic indexer, reuses unchanged entries, records added/changed/removed/renamed paths, and regenerates `.lgs/index.json` and `.lgs/CODEBASE_MAP.md`. Because updating the map changes audit context, the DocumentationAgent must run again afterward.

The DocumentationAgent uses the `documentation-agent` role mapping from `agents.roleModels`; when it is not explicitly mapped, it shares the Manager provider connection and model as an independent logical request. Provider connections and model names remain configuration rather than hardcoded implementation details.
