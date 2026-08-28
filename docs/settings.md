# Settings and configuration

## Precedence

Effective scalar values resolve in this order:

1. built-in default;
2. user value in VS Code extension global state;
3. workspace value under `settings:` in `.lgs/config.yaml`.

The Settings page labels the effective source. Malformed YAML is reported without crashing the extension. A saved value is reloaded immediately. A workspace value overrides the user value; the Appearance section calls this out before a user-scoped selection can be mistaken for the active workspace choice.

## Live Settings sections

- **Appearance**: visual cards for Follow VS Code, Research Paper, or Warm Dark. Clicking a card applies and saves it immediately; no Apply button is used.
- **Providers**: default connection/model, independent connection cards, adapter-aware forms, model discovery, managed Ollama ownership, provider logs, and usage statistics.
- **Skills**: installed global/project skills, scope, source, enabled state, files, and creation.
- **Plugins**: executable capability/integration boundary kept distinct from providers and skills.
- **Agent Profiles**: scoped skills, capabilities, provider preferences, permissions, and verification requirements.
- **Permissions**: a live matrix for scalar computer-access controls plus the complete workspace policy entry point.
- **Usage**: opens the provider-neutral usage dashboard and explains reported versus estimated billing.
- **Integrations**: opens the structured catalog configuration without presenting disconnected declarations as live.
- **Verification**: opens Definition-of-Done, command-array, documentation, runtime, and review configuration.
- **Diagnostics**: restart/reconnect/reload actions with an explicit process-ownership boundary.

Structured policy is intentionally not duplicated as placeholder form controls.

## Provider profiles and secrets

Profiles are selected by a generated stable connection ID, not display name or adapter type. Display Name is arbitrary user-facing text. Multiple OpenAI-compatible profiles may use the same adapter or expose the same API model ID without sharing identity, URL, headers, aliases, capabilities, context overrides, discovery policy, billing, or data policy.

The add/manage workflow shows only adapter-relevant fields for Ollama, OpenAI, OpenAI Compatible, and Anthropic. Advanced configuration covers normal and secret headers, discovery path/manual models, model aliases, capability/context overrides, billing/pricing, and privacy/data policy. New offline profiles require an explicit “save without a successful test” acknowledgement.

Profile metadata is stored in global state. API keys and secret custom-header values are stored only in VS Code SecretStorage. The webview receives `hasApiKey` and secret-header names—not values. Editing never fills stored secrets back into the form. Removing a profile removes its associated LGS-managed secrets and pricing entries.

## Appearance switching

Theme cards are the control. A click updates the Settings document immediately, persists `appearance.theme` to the selected User or Workspace scope, and asks the extension host to refresh the sidebar. Follow VS Code uses semantic `--vscode-*` roles. Research Paper uses warm ivory, graphite, academic green, and brass; Warm Dark uses deep navy, slate, sage, warm off-white, and amber. Responsive breakpoints reflow theme/provider cards and forms without horizontal clipping.

## Recovery controls

The Restart LGS menu offers:

- **Restart LGS services**: cancels an active LGS request, reloads settings, and rebuilds connection adapters.
- **Reconnect providers**: recreates adapters and runs real discovery tests for every enabled profile.
- **Restart LGS-owned local runtimes**: acts only on tracked LGS-owned children; external Ollama, LM Studio, llama.cpp, and similar processes are never terminated.
- **Reload LGS views**: republishes current sidebar and Settings state without a workbench reload.
- **Reload VS Code Window**: invokes the explicit full-window reload command.

Every operation returns visible status. Provider activity records lifecycle operations without credentials or model content.

## Computer-policy precedence

Explicit structured keys under `computer:` in `.lgs/config.yaml` take precedence over scalar Settings values. Otherwise a non-default user/workspace scalar value applies. This keeps security-sensitive workspace policy reviewable while allowing convenient defaults.

See `.lgs/config.yaml` for the executable/argument-array verification schema and current Completion Guard gates.

## Research, context, and BrowserAgent policy

Auto Research and capabilities are separate composer controls. Workspace defaults and budgets use the structured `research` section; context pressure thresholds use `context.lifecycle`; and external browser policy stays under `runtime.browser`:

```yaml
research:
  autoResearch: when-uncertain
  webEnabled: true
  budgets:
    maximumCycles: 24
    maximumConsecutiveFailedCycles: 5
    wallClockMinutes: 240
    minimumProgressCycles: 3
context:
  lifecycle:
    softPressurePercent: 70
    compactionPercent: 82
    rotationPercent: 92
runtime:
  browser:
    externalSites: true
    consequentialActions: ask
```

`research.webEnabled` permits external research but does not initiate it. `research.autoResearch` controls initiation and can force an evidence requirement after uncertainty or a version-sensitive external assumption. BrowserAgent asks before consequential external-site actions by default. Full behavior is documented in [research-workflows.md](research-workflows.md).
