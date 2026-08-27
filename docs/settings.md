# Settings and configuration

## Precedence

Effective scalar values resolve in this order:

1. built-in default;
2. user value in VS Code extension global state;
3. workspace value under `settings:` in `.lgs/config.yaml`.

The Settings page labels the effective source. Malformed YAML is reported without crashing the extension. A saved value is reloaded immediately.

## Live Settings sections

- **Appearance**: Follow VS Code, Research Paper / Light, or Research Lab / Dark.
- **Models & Providers**: default connection/model and independent connection profiles.
- **Computer Access**: external read/write, system/package/elevated command, document extraction, dry-run, and retention policies.
- **Engineering Systems**: opens `.lgs/config.yaml` for structured agent, routing, integration, context, verification, runtime, Git/completion, usage, memory, skill, and permission policy.

Structured policy is intentionally not duplicated as placeholder form controls.

## Provider profiles and secrets

Profiles are selected by connection ID, not adapter type. Multiple OpenAI-compatible profiles may use the same adapter without sharing identity, URL, headers, aliases, capabilities, or data policy.

Profile metadata is stored in global state. API keys and secret custom-header values are stored only in VS Code SecretStorage. The webview receives `hasApiKey`, secret-header names, and counts—not values. Removing a profile removes its associated stored secrets.

## Computer-policy precedence

Explicit structured keys under `computer:` in `.lgs/config.yaml` take precedence over scalar Settings values. Otherwise a non-default user/workspace scalar value applies. This keeps security-sensitive workspace policy reviewable while allowing convenient defaults.

See `.lgs/config.yaml` for the executable/argument-array verification schema and current Completion Guard gates.

