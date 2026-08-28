# Tool-first interaction architecture

## Composer

The composer is the primary command surface. It contains multiline input, explicit attachments, a circular context meter, provider/model selection, reasoning only when the selected model advertises support, Normal/Plan/Web/Research mode, Send, and Stop. File and image attachment are the supported add-context sources in the webview; unsupported folder or URL controls are not displayed. Submitted attachment metadata remains associated with its user message.

Context capacity comes from selected-model metadata or provider usage. Missing capacity or usage stays unavailable; LGS does not estimate silently. Category detail is rendered only when a runtime supplies reliable category values, including conversation, repository, attachments, active skills, agent instructions, or runtime overhead.

## Request, phase, and activity state

```text
conversation
  -> user request
  -> RequestExecution
  -> WorkPhase[]
  -> ActivityEvent[]
  -> final request outcome
```

A request owns one start time and optional end time. Phase changes never reset the top-level timer. Phases expose a stable ID, name, concise goal, assigned profile, timestamps, status, and optional result. Activity records observable actions such as tool calls, file resources, commands, tests, provider work, warnings, and verification. They are operational evidence, not model reasoning.

The chat Details row is the concise phase history. The separate Activity Log panel is the detailed, filterable, live trace. Request summaries are stored in `.lgs/tasks/<request-id>/request.json`; events are append-only JSON Lines in `activity.jsonl`.

## Execution modes

Modes are capability policies rather than unrelated booleans:

- Normal: inspect, edit, commands, and verification.
- Plan: inspect and plan; mutation is blocked.
- Web: inspect and external research; repository mutation is blocked.
- Research: inspect, plan, web research, edit, commands, verify, and iterate toward a goal.

The existing tool permission, workspace, privacy, and approval gates remain authoritative within every mode.

## Extensibility boundary

- A Provider supplies a model/runtime.
- A Skill supplies scoped behavioral instructions and resources.
- A Plugin supplies executable capability or an integration.
- An Agent Profile selects skills, capabilities, provider policy, permissions, and verification requirements.
- A task phase selects an Agent Profile.
- An Activity Event records observable execution.

Project agent configuration is version-controlled in `AGENTS.md` and `.agents/{skills,profiles,config.json}`. Skill routing reads metadata first, loads `SKILL.md` only for selected skills, and leaves references unloaded until needed. `ExtensionSource<T>` establishes the future marketplace/Git/local/package boundary; arbitrary external content is not implicitly trusted or installed.
