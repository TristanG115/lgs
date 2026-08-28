# Provider connections

## Supported adapters

- Ollama: `/api/tags` discovery and NDJSON `/api/chat` streaming.
- OpenAI: the OpenAI-compatible `/models` and SSE chat-completions adapter with the official base URL default.
- OpenAI-compatible: configurable `/models`, SSE chat completions, ordinary/secret headers, aliases, and capability/context overrides.
- Anthropic: Messages API SSE with normalized text, usage, cancellation, and errors.

Every selected model is scoped to its provider connection. Same-named models on different profiles do not collide.

## Managed Ollama lifecycle

On activation LGS tests each enabled Ollama endpoint. A healthy endpoint is classified as external unless LGS already owns its child process, and no duplicate server is started. An unavailable local endpoint may auto-start `ollama serve` only when the profile selects LGS-managed mode and automatic startup. Readiness uses bounded backoff, then model discovery and health are refreshed. Remote endpoints are never used to trigger a local process launch.

Process ownership is strict. Restart and termination operate only on the exact child spawned and tracked by the current LGS runtime. An already-running or otherwise external Ollama receives Test/Reconnect/Edit actions and is never killed. Managed stdout/stderr is retained in a bounded provider log, separate from per-request activity events.

## Connection workflow

Open LGS Settings, choose **Models & Providers**, and add or manage a profile. LGS generates its stable ID; Display Name does not control provider identity. The selected API Type reveals only relevant fields. Automatic discovery may use an optional path override, manual discovery accepts explicit model IDs, and disabled discovery remains visibly unavailable.

**Test connection** performs a real adapter request and checks reachability, authentication acceptance, model discovery, and response compatibility as far as the protocol permits. Failures are normalized into actionable status such as connection refused, host resolution, authentication rejected, rate limited, server failure, timeout, or protocol mismatch. The UI includes the endpoint and safe recovery guidance instead of returning only `fetch failed`. A new connection can be saved while offline only after explicit acknowledgement.

A failed endpoint remains visibly failed; LGS does not synthesize models or a connected state. Status also updates during actual model requests. The sidebar uses the configured default connection/model when available and otherwise chooses the first enabled profile and discovered model.

Do not put credentials in `.lgs/config.yaml`, profile headers, chat prompts, or test fixtures. Use the API-key and secret-header fields so values enter SecretStorage.

## Cards, models, activity, and statistics

Saved cards show display name, API type, endpoint summary, live state, enablement, model count, last check, billing classification, and data policy. Manage exposes aliases, discovered model capabilities, context information, and manual overrides. Test/refresh discovery uses the selected profile, so identical model IDs from different profiles remain distinct.

Per-connection activity combines safe lifecycle/discovery records with normalized usage records. Filters cover errors, requests, models, connection, and usage. Raw diagnostics are bounded and redact authorization, API keys, tokens, credential query parameters, configured secret headers, and explicit secret values. Complete prompts and responses are not stored for provider diagnostics.

Statistics are derived only from available usage fields: request outcomes, input/output/cached/reasoning tokens, generation and latency timing, throughput, context, models, tasks, agents, and reported/estimated cost. Older or incomplete records display unavailable outcomes rather than manufactured success. `institution_provided` is a first-class billing classification and is not rendered as zero-dollar commercial usage.

## Capabilities and reasoning

Streaming, cancellation, multimodal, system-instruction, usage, and reasoning support are normalized as capability metadata. Auto reasoning omits provider-specific parameters; Low, Medium, or High is sent only when the selected profile reports support (or an explicit compatible capability override enables it). The composer marks unsupported or unadvertised reasoning instead of fabricating support. LGS never exposes hidden chain-of-thought.

## Audit status

The 2026-08-27 upgrade exercised provider creation/edit/delete, same-adapter identity, secret storage/removal, discovery and reconnect against local mocked Ollama and OpenAI-compatible protocol responses, status persistence, redaction, statistics, and all lifecycle branches in automated tests. The compiled Settings webview was also exercised in headless Chromium for theme switching, adapter-dependent fields, explicit offline save, provider logs, restart actions, and narrow-width reflow.

No real external provider credential or running local model was available during this pass. A live streamed response from an external provider therefore remains unverified and is not reported as passed.
