# LGS (Little Grad Student)

LGS is a VS Code extension for reliable software-engineering agents. Phase 14 adds fresh-context independent review and Manager disposition on top of mechanically enforced documentation, version-aware research, the read-only Watchdog, manager-and-worker orchestration, the evidence-backed Completion Guard, controlled verification, provider-neutral model backends, and deterministic Repository Intelligence.

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
- `src/review/` — fresh Reviewer evidence, structured findings, Manager dispositions, approval freshness, and completion integration.
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

The compact LGS webview is a research workspace: a notebook-like session list, quiet monogram empty state, Advisor profile/model controls, Committee Review completion checks, and a bottom composer. Its design system uses semantic `--lgs-*` tokens for backgrounds, surfaces, text, borders, primary/accent actions, and success/warning/danger states; components never select palette values directly. Keyboard focus follows VS Code conventions, motion is reduced for `prefers-reduced-motion`, and all controls have accessible labels.

## Task workflow and observability

Phase 25 makes the active engineering task visible above its chat transcript. The task header shows the objective, Advisor model/provider, progress, context, and cloud cost. Tabs organize **Chat**, **Task**, **Agents**, **Changes**, **Research**, **Verification**, and **Usage**; the workspace navigation also links Tasks, Models, Integrations, Skills, Memory, Usage, and Settings. The dashboard shows only observable actions, tool/evidence summaries, structured results, agent assignments, and Completion Guard status—it never exposes private model reasoning.

Task controls provide pause/cancel, approval/rejection, retry/escalation, diff, logs, research, and durable task-state access. Controls use the typed webview message contract and preserve the extension host as the permission boundary. Agent cards identify the logical role, provider/model, and current state; the activity feed is intentionally compact to avoid notification noise.

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

The General, Appearance, Models & Providers, Agents, Integrations, Context, Verification, Git, Usage & Budgets, Memory, Skills, Permissions, and Advanced sections are navigable. Unimplemented sections show explicit placeholders rather than nonfunctional controls. Appearance changes apply to open LGS webviews without restarting VS Code: **Follow VS Code** maps every semantic role to native `--vscode-*` variables, while **Research Paper / Light** and **Research Lab / Dark** use restrained parchment/forest and navy/sage palettes respectively. The setting may be stored per-user or per-workspace.

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

## Adaptive Model Routing

Phase 21 assigns a complete provider-connection/model identity to engineering roles: `fast`, `worker`, `manager`, `researcher`, `documentation`, `reviewer`, `difficult`, `vision`, and `cloudEscalation`. A route is always recorded in `.lgs/tasks/<task-id>/routing.json` with its concise reason, selected profile/model, policy, and timestamp; source code and secrets are never recorded there.

Routing evaluates the role, required context window, tool or vision support, configured benchmark score and failure history, task difficulty, local preference, and cost tier. `preferCheapest` selects the weakest appropriate configured model first; disable it when correctness or latency should dominate. A task pin takes precedence over a role pin, and a role pin takes precedence over automatic selection.

```yaml
routing:
  policy:
    privacy: ask_before_cloud # local_only, cloud_allowed, or ask_before_cloud
    preferLocal: true
    preferCheapest: true
    maxCostTier: medium
  roles:
    fast:
      profileId: local-ollama
      model: qwen3.5:9b
      toolSupport: true
      costTier: low
    difficult:
      profileId: purdue-genai
      model: gpt-5
      contextWindow: 128000
      benchmarkScore: 9
      costTier: high
  models:
    - profileId: local-ollama
      model: gpt-oss:20b
      toolSupport: true
      costTier: medium
      benchmarkScore: 7
```

Use the Models & Providers Settings page to declare each connection's data policy: `local`, `repository_allowed`, or `metadata_only`. `local_only` and `ask_before_cloud` both prevent automatic repository-source routing to cloud connections; `metadata_only` is never eligible for repository-aware work. The Phase 11 escalation controller accepts the same router and skips a forbidden escalation destination instead of sending source silently. Existing `watchdog.escalation.routes` remain explicit route pins and retain their original ordering.

## Usage, context and cost observatory

Phase 22 records one local, normalized metric record for each observed model request in `.lgs/usage.jsonl`. Records contain only identity, numeric usage, timing, context, savings, and cost metadata—never prompts, source text, tool payloads, or completions. Fields a provider does not report remain absent. The **LGS: Open Usage Dashboard** command groups requests by agent, task, session, model, provider connection, workspace, and day; it answers which models consumed tokens, which agents consumed context, how much candidate context was avoided, local-model speed, task cost, and cloud-escalation frequency.

Context values are presented as `21.8K / 32K` and `68%` whenever both known values are available. Request producers may optionally identify objective/task, Codebase Map, source, Git, research, memory, tools, conversation, and reserve tokens; the same record can hold raw candidate context, selected context, tokens avoided, and reduction percentage. LGS does not estimate missing token counts from text length.

Provider-reported cost and LGS-estimated cost are separate. Pricing is maintained independently in ignored `.lgs/pricing.json`, keyed by `connectionId` or `connectionId:model`; commercial entries declare per-million input, cached-input, and output prices. Set a connection or model to `institution_provided` for arrangements such as Purdue GenAI—LGS will not misrepresent this as `$0.00` commercial API cost. Local connections are marked `local` with API monetary cost not applicable; that does not claim that local electricity or hardware is free.

```yaml
usage:
  retentionDays: 90
  maxRecords: 10000
  budgets:
    maxCloudSpendPerTask: 2.50
    maxCloudSpendPerPeriod: 25.00
    periodDays: 30
    warnAtPercent: 80
    askBeforeCloudEscalation: true
    contextUtilizationTarget: 75
```

The router can receive the usage budget gate, so exhausted task/period budgets and required cloud-escalation confirmation block automatic cloud candidates while retaining the current route. `get_usage_dashboard`, `get_usage_records`, `cleanup_usage_records`, and `configure_usage_pricing` expose the same local-only controls to agents. Retention cleanup applies the configured age and record-count limits.

## Advanced context optimization

Phase 23 adds a retrieval-first `ContextBroker`. `select_context` begins with deterministic repository and module metadata, then descends through directory, file, symbol, and exact source range only when the objective or agent explicitly needs that detail. It ranks candidates using task terms, explicit agent path/symbol requests, imports, reverse dependencies, related tests, and optional Git, research, and semantic relevance signals. Identical content is deduplicated before selection; required task evidence is protected even when a budget is tight.

The broker does not blindly summarize source. It returns selected metadata and original source ranges, with an uncompressed fallback always available through the existing repository tools. Optional generic prompt compression is intentionally not enabled: it would require measurable savings, reliable dependencies, protected critical requirements/code, and an uncompressed fallback before it can be accepted.

Every selection computes candidate tokens, selected tokens, saved tokens, savings percentage, and an objective/Codebase Map/source/Git/research/memory/tools/conversation/reserve category breakdown. The next observed model request receives those selection metrics through the Usage Observatory. Existing worker reports, Git history, command logs, and research findings remain compact by design; raw logs, commits/diffs, and provenance remain explicitly retrievable.

Task state now carries bounded, deduplicated verified facts, design decisions, failed approaches, and blockers alongside the objective, plan, modifications, and remaining work. This makes task continuity compact without discarding required engineering evidence.

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

## Independent review

Phase 14 prevents the implementation agent from being the sole judge of its own work. After implementation, verification, research, and documentation are current, the Manager calls `run_independent_review`. LGS creates a new Reviewer inference request containing only the original objective, acceptance criteria, final/current diff, bounded relevant source and tests, compact verification results, retained research findings, documentation changes and audit state, plus the task-start baseline of staged, unstaged, and untracked user changes. The implementation conversation and worker transcripts are never included.

The Reviewer actively looks for correctness bugs, missed requirements, regressions, edge cases, security problems, unsupported assumptions, missing or weak tests, stale documentation, architecture problems, unnecessary scope, and accidental modification of preexisting user work. Findings are compact records with severity, confidence, location, description, evidence, and a recommended action. Reviews are retained in `.lgs/tasks/<task-id>/reviews.json` and available through `get_review_state`.

A review with no findings is approved immediately. Otherwise it remains pending until the Manager calls `evaluate_review_findings` with an evidenced `confirmed` or `dismissed` decision for every finding. Confirmed findings are appended to remaining task work, produce the existing `reviewer_rejection` escalation trigger, and should be delegated to an Implementer or Debugger. The required loop is fix → targeted/full tests as appropriate → documentation audit and map update → fresh Reviewer check. Verification continues through the existing `VerificationRunner`, so the same-error and total-fix retry budgets still apply.

Review freshness is mechanical. Its fingerprint covers the workspace and CODEBASE_MAP, task-state revision, command evidence, research findings, and DocumentationAgent audit. Any later code, test, verification, research, documentation, map, or task-state change invalidates approval and requires a fresh review iteration. This also prevents an old approval from being reused after a fix.

Set `completion.gates.independent_review_passes: true` in `.lgs/config.yaml` when independent approval is mandatory. Completion Guard then blocks when review has not run, findings await Manager evaluation, changes were requested, or the latest approval is stale. When the gate is disabled, the tools remain available for risk-based review.

The Reviewer uses `agents.roleModels.reviewer`. If no Reviewer-specific mapping exists, it shares the Manager provider connection and model through a separate logical request with a fresh context; no model or provider is hardcoded.

## Runtime and browser verification

Phase 15 adds generic, opt-in runtime checks. `start_runtime` launches the configured command as an LGS-owned process and tracks its LGS process ID, operating-system PID, command, owning task, startup and readiness state, bounded output, raw output artifact, and crash/exit state. LGS never terminates a process it merely discovers: `stop_runtime` accepts only an LGS-managed process ID.

```yaml
runtime:
  start:
    command: npm
    args: [run, dev]
  healthcheck:
    url: http://localhost:3000
    expectedStatus: 200
  acceptance:
    - type: browser_open
      url: http://localhost:3000
    - type: browser_get_text
      selector: "#login-button"
      expectedText: Log in
    - type: browser_console
      expectedErrors: 0
    - type: browser_network_errors
      expectedErrors: 0
```

The supported browser tools are `browser_open`, `browser_click`, `browser_type`, `browser_get_text`, `browser_wait_for`, `browser_screenshot`, `browser_console`, and `browser_network_errors`. They use an isolated Playwright Chromium session. Screenshots and complete process output live in ignored `.lgs/runtime/` artifacts; concise failures and artifact paths are persisted for the Debugger. Install a compatible browser on a development machine with `npx playwright install chromium`.

`run_runtime_verification` runs the configured startup, health check, and acceptance sequence, returning concise check results. Set `completion.gates.runtime_verification_passes: true` only for tasks that require runtime or browser evidence. Projects without a runtime configuration are not forced into browser automation.

## Verified commits

Phase 16 exposes `create_verified_commit` after every required Completion Guard gate passes. It stages only task-tracked modifications that did not exist in the task-start Git baseline, inspects the staged diff, blocks obvious secret-like values, and refuses mixed files that overlap preexisting user work (which require manual hunk separation). The detailed commit body records Goal, Changes, Documentation, Verification, Files, and `LGS-Task` for future history inspection.

## Skills and long-term memory

Workspace skills live in `.lgs/skills/<name>/SKILL.md`. Their YAML frontmatter declares `name`, `description`, optional `applicableTasks`, `activationRules`, and `estimatedTokenCost`; adjacent files are available as supporting material. LGS lists, manually activates, or Manager-selects relevant skills within a stated token budget, rather than injecting every skill.

Long-term memory is local durable knowledge in ignored `.lgs/memory.json`, deliberately separate from authoritative task state. Store concise architecture decisions, conventions, debugging discoveries, recurring patterns, and approved behavior with `remember_project_knowledge`. `search_project_memory` returns only relevant entries within a token budget. Inspect size and retention with `get_memory_state`, enable or disable it with `set_project_memory_enabled`, adjust session retention with `configure_project_memory_retention`, delete individual entries with `delete_project_memory`, and apply retention/size limits with `compact_project_memory`.

## Planning and reasoning controls

LGS normalizes reasoning as `{ enabled, effort: low | medium | high }` and exposes capability metadata instead of claiming unsupported controls are active. Connections report reasoning unsupported by default; an OpenAI-compatible connection can opt in through an explicit capability override, which maps the normalized effort to `reasoning_effort`. Planning Mode permits repository reads, research, and Git history, while the tool executor rejects file mutations and mutating commands. An approved plan can be persisted with `create_plan_task`, including its objective, acceptance criteria, and subtasks. LGS does not reveal hidden chain-of-thought; provider-emitted thinking should be summarized as concise actions.

## Integrations

The Integration Hub normalizes MCP servers, LGS plugins, and connected apps into descriptors with origin, health, requested permissions, capabilities, allowed agents, and process ownership. External tools are schema-validated and registered through the normal LGS tool framework; their callers do not depend on the originating transport. `.lgs/config.yaml` may declare `integrations.required`, `recommended`, and `optional` IDs without secrets. The current local catalog is intentionally explicit: an integration must be registered and healthy before its capabilities are exposed, and agent-role restrictions are enforced at invocation time. `list_integrations` provides the browser-ready Installed/MCP/Apps data surface; only LGS-owned processes may be stopped by future MCP lifecycle controls.

## Local runtimes and benchmarks

`discover_local_runtimes` safely probes Ollama, LM Studio, llama.cpp-compatible, and explicitly configured OpenAI-compatible endpoints without launching, restarting, or stopping any server. It reports state, available models, exposed capabilities, and ownership. Benchmark history is stored locally in ignored `.lgs/benchmarks.json`; `record_model_benchmark` records representative navigation, tool selection, implementation, debugging, review, instruction-following, and planning cases. Speed metrics (latency and tokens/sec) are stored separately from optional quality scores so LGS never treats the fastest model as automatically best.
