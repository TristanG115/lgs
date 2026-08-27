# LGS architecture

## Runtime boundary

LGS has two trust zones:

1. `src/webview/main.ts` renders the sidebar and sends validated `ClientMessage` values.
2. `src/extension.ts` owns VS Code APIs, settings, secrets, provider requests, tools, permissions, task state, and filesystem/process access.

The sidebar sends a `ready` handshake after its listener is installed. The extension then supplies profiles, model/options state, appearance, sessions, and connection status. No credential or secret header is sent to a webview.

## Engineering request flow

```text
sidebar request
  -> LgsViewProvider
  -> SettingsManager + ModelRouter
  -> provider-specific ModelBackend
  -> RoutedToolLoopModel
  -> ToolExecutor and ToolRegistry
  -> repository, Git, editing, verification, research, review, runtime, or computer service
  -> normalized tool result + audit metadata
  -> model continuation
  -> Completion Guard
  -> sidebar task evidence
```

`ToolExecutor` treats model calls as untrusted. It validates the envelope and JSON-like schema, blocks mutation in Planning Mode, applies cancellation, bounds serialized output, normalizes errors, and redacts secret-named audit arguments.

## Persistent state

- VS Code global state: user scalar settings, provider-profile metadata, chats, and Git baselines.
- VS Code SecretStorage: API keys and secret custom-header values.
- `.lgs/config.yaml`: reviewable workspace policy and workspace scalar overrides.
- `.lgs/index.json` and `.lgs/CODEBASE_MAP.md`: deterministic repository intelligence.
- `.lgs/tasks/<task-id>/`: task state, edit undo records, evidence, reviews, research, routing, runtime checks, and completion data.
- `.lgs/logs/`, `.lgs/runtime/`, `.lgs/usage.jsonl`, and related ignored files: bounded local operational evidence.

## Safety invariants

- Repository and edit paths remain workspace-relative and are checked against traversal and symlink escape.
- File replacement, deletion, rename, and undo use SHA-256 optimistic concurrency.
- Commands use executable/argument arrays with shell mode disabled.
- Runtime shutdown accepts only LGS-owned process IDs.
- Verified commits require Completion Guard, task attribution, an empty pre-existing Git index, no overlap with the captured user baseline, an exact staged path set, and a secret scan.
- External-file and computer operations use a separate trusted-location policy; they do not inherit workspace command permission.

## Honest capability boundaries

Integration declarations are catalog metadata until a healthy concrete connector is registered. Provider adapters cannot be considered live-tested without an available endpoint and model. Role agents are logical sessions and may share one physical provider/model; their isolation is message-context isolation, not a separate operating-system process.

