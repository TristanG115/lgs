# Full-system audit and readiness review — 2026-08-27

## Overall status: FUNCTIONAL ALPHA

LGS activates, renders a coherent Research Lab / Research Paper experience, persists settings and task state, discovers providers honestly, runs a validated tool loop, safely edits and undoes workspace files, executes controlled verification, and mechanically gates completion and commits. It is usable for development with known constraints, but it is not beta-ready because no real model endpoint was available for a complete streamed task, external integrations remain disconnected catalog entries, and several advanced systems have automated rather than real-provider end-to-end evidence.

## Verification summary

| Check | Result |
| --- | --- |
| Typecheck | Passed |
| ESLint | Passed |
| Unit/integration tests | 25 files / 117 tests passed in child-process-enabled environment |
| Production build | Passed |
| Diff whitespace | Passed |
| Extension Development Host | Activated `lgs.lgs`; sidebar and Settings rendered |
| UI matrix | 240 px and 520 px harness plus 293 px live sidebar and 786 px live Settings; no horizontal overflow |
| Themes | Follow VS Code, Research Paper, and Research Lab switched at runtime in both open webviews |
| Provider/model | Real default Ollama connection attempted; blocked because no server/model was available; failure shown honestly |
| Full live model task | Blocked by unavailable provider/model |
| Persistence | Automated coverage plus live user-theme source/update |

The suite initially failed inside the managed sandbox because Git/Node spawning and localhost binding were denied. The identical suite passed when those explicitly requested disposable operations were allowed.

## Repaired systems

### Critical and high

- Added the missing workspace mutation path: replace, create, delete, rename, fingerprint, and durable undo tools are registered in the live model tool registry.
- Rechecked file fingerprints after permission prompts, preventing user edits made during approval from being overwritten.
- Rejected intermediate symlink escape, traversal, absolute paths, overwrite, and stale/conflicting undo.
- Automatically attributed successful edits to persistent task state and removed attribution when an operation was fully undone.
- Fixed strict verified-commit staging for task-attributable renames by validating with rename detection disabled.
- Replaced fabricated dashboard data and inert controls with host-sourced task state, agent assignments, Completion Guard, research/review/usage evidence, and four real evidence actions.
- Added a sidebar readiness handshake so initial profile, options, appearance, session, and connection messages cannot race webview startup.
- Bound the sidebar Settings button directly to the live Settings panel while retaining the command-palette command.

### Medium and UX

- Rebuilt sidebar and Settings hierarchy around an original academic Research Lab / Research Paper identity.
- Implemented runtime theme propagation and true VS Code semantic-variable following.
- Removed future-phase placeholder settings for systems already configured in `.lgs/config.yaml`.
- Composed routing, usage/pricing, runtime verification, integration status, Computer Agent permissions, and dashboard evidence into the running extension.
- Corrected structured computer-policy precedence, MCP configuration parsing, lazy Playwright loading, and added explicit webview CSP declarations.
- Replaced canned success/error presentation with loading, disabled, empty, and dismissible error states.

### Repair evidence matrix

| Problem | Cause | Repair | Verification |
| --- | --- | --- | --- |
| Workspace edits were absent from the running tool loop | Editing contracts existed only in an untracked, disconnected subsystem | Registered task-bound replace/create/delete/rename/fingerprint/undo tools and wired permission, persistence, and Planning Mode | New disposable-repository editing tests cover mutation, undo, conflicts, escape, denial, task attribution, and read-only mode |
| A permission prompt could leave an edit vulnerable to a stale write | Fingerprints were checked before, but not after, awaiting approval | Recheck all source and destination fingerprints after approval | Regression test changes a file during approval and confirms conflict refusal |
| Rename commits could reject the correct task path set | Git rename detection collapsed the staged source and destination into one name | Validate the staged set with rename detection disabled | Verified-commit rename regression test passes |
| Sidebar state could race webview startup | Host state was posted before the client listener was guaranteed ready | Added a typed client-ready handshake and serialized backend rebuild | Message tests, deterministic UI harness, and live Extension Host initialization pass |
| Settings and dashboard surfaces overstated implementation | Placeholder controls and canned dashboard records were not tied to concrete services | Rebuilt both surfaces around the settings registry, provider profiles, task stores, Completion Guard, routing, usage, research, review, and execution evidence | Control-inventory harness exercises every exposed action; live provider errors and theme changes propagate correctly |
| Theme selection did not provide a finished product identity | Sparse styles and incomplete runtime propagation | Added semantic VS Code mapping plus original Research Paper and Research Lab palettes across open webviews | All three modes switch live; narrow/wide overflow checks pass |

## Confirmed working systems

Automated execution directly covered repository indexing/freshness, read-only tools and path security, Git intelligence, command execution, targeted verification, Completion Guard, task persistence, orchestration isolation/lifecycle, Watchdog/escalation, research storage/providers, DocumentationAgent freshness, independent review, managed runtime/browser checks, verified commits, skills/memory, planning-mode mutation blocking, integration permission/health behavior, local-runtime discovery, routing, usage/context/cost, Context Broker selection, Computer Agent policy/activity/decision records, message schemas, settings, provider stream parsing, and workspace editing/undo.

The live Extension Host covered activation, view contribution, sidebar initialization, unavailable-provider failure, Settings opening, provider Test & discover failure, theme propagation, responsive overflow, and absence of LGS webview exceptions. A deterministic Playwright harness exercised new task, session navigation, provider/model selection, Planning Mode, reasoning, approval, send/stop state, task/evidence navigation, usage, Completion Guard, error dismissal, and all three themes.

## Provider and model findings

- Ollama, OpenAI-compatible, and Anthropic adapters have parser, discovery, streaming, cancellation, error, and usage-normalization test coverage.
- The live configured Ollama endpoint was contacted from both the sidebar and Settings. No runtime/model was available, and both surfaces reported `fetch failed` without claiming a connection.
- Provider profiles remain connection-specific, support same-adapter endpoints, and expose secret presence rather than secret values to webviews. Profile discovery/test uses the selected profile identity.
- No credentials were available or invented. Consequently, real streamed output, live Stop behavior, provider switching, and live usage/context metadata remain blocked rather than passed.

## Agent-system findings

- Persistent task state, Context Broker selection/budgeting, read-only tools, controlled editing, execution, verification, Completion Guard, and verified commits are wired into the extension-host composition and covered by executable integration tests.
- Planning Mode mechanically blocks mutating tools. Task dashboards derive state from durable task, orchestration, verification, usage, research, and review sources rather than hidden reasoning or demo records.
- Orchestration context isolation, worker lifecycle/cancellation, Watchdog retry/escalation, research persistence, documentation freshness, independent-review gates, routing, skills, memory, runtime ownership, and Computer Agent policy/auditing pass focused automated tests.
- The advanced agent systems were not collectively driven by a real inference endpoint in this audit. Their status is integration-tested, not live-model end-to-end verified.

## Remaining incomplete or blocked systems

1. **Real provider smoke — blocked:** no available Ollama or credentialed cloud/institutional endpoint, so actual streamed output, live cancellation, model switching, and provider-reported usage were not demonstrated in this environment.
2. **Full live agent task — blocked:** without a real model, the requested inspect → plan → edit → verify → document → review → complete → commit workflow could not be driven by an actual inference. Its components are covered independently with executable integration tests.
3. **Integration marketplace — incomplete:** configured plugin/MCP/app IDs are honest disconnected descriptors. There is no install/connect marketplace UI or generic transport startup in the extension composition.
4. **Advanced real-provider agents — limited evidence:** orchestration, Watchdog model analysis, research, documentation, reviewer, and routing pass deterministic/mocked integration tests but were not exercised with independent live models during this audit.
5. **Extension test runner — absent:** there is no separate `@vscode/test-electron` suite; Extension Host behavior was checked through CDP automation and logs.
6. **Activity persistence for ordinary tools — partial:** tool audit events are written to the LGS output logger and live dashboard; the Computer Agent has a durable ledger, but the general tool loop does not yet persist one unified JSONL activity ledger for every ordinary tool call.
7. **VS Code CSP diagnostic — unresolved:** the live sidebar document contains an explicit restrictive CSP and produced no CSP violation, but the Extension Host still logged one `lgs.lgs created a webview without a content security policy` warning. This requires a dedicated VS Code integration-test reproduction before beta.

## Security and safety findings

- Secrets remain extension-host-only in SecretStorage; webviews receive presence metadata only.
- Model tool calls are schema-validated, result-bounded, cancellable, and secret-redacted in audits.
- Workspace edits and reads reject escape; mutating edits use optimistic concurrency and durable undo.
- Commands avoid shell evaluation and use explicit cwd, environment, timeout, permission, and cancellation controls.
- Verified commits refuse baseline overlap, pre-staged content, path-set mismatch, stale Completion Guard, diff whitespace errors, and likely secrets.
- External-file and elevated operations are separately policy-gated. No credentials or privileged destructive operations were used during the audit.

## UX findings

The original UI was an early prototype with weak hierarchy, dead navigation, canned task activity, placeholder settings, and hard-to-read errors. The repaired UI has a dense but calm notebook hierarchy, compact composer controls, real session/task navigation, explicit loading and connection failure states, actionable evidence access, accessible labels/focus, and responsive semantic themes. No horizontal overflow was observed at the tested widths. The application no longer claims nonexistent lifecycle or integration actions.

## Phase-history finding

Git history contains separate implementation commits from repository intelligence through computer access. Files and tests existed for most claimed phases, but history alone overstated integration: later services were frequently present without complete extension-host composition, the phase-era README retained superseded/future wording, and workspace editing was absent entirely. This audit therefore treated the running `src/extension.ts` composition and executable evidence—not commit titles—as the source of truth.

## Technical debt by priority

1. Add a reproducible real-provider smoke environment and an opt-in VS Code integration test suite.
2. Build live integration lifecycle/install/connect UI only after concrete transports and permission review exist.
3. Persist a unified redacted activity ledger for all tool-loop operations.
4. Break up dense legacy one-line modules/tests to improve reviewability without changing behavior.
5. Resolve the VS Code missing-CSP diagnostic and replace deprecated Vite CJS test-runner usage; continue monitoring the VS Code/Electron `url.parse()` warning, which originated outside LGS.

## Readiness recommendation

Use LGS as a functional alpha in controlled repositories. Before beta, require one reproducible real-model end-to-end task (including cancellation and usage), a VS Code integration-test runner in CI, and at least one concrete end-to-end integration transport. Do not add more phase-labeled surface area until those evidence gaps are closed.
