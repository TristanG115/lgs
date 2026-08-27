# Provider connections

## Supported adapters

- Ollama: `/api/tags` discovery and NDJSON `/api/chat` streaming.
- OpenAI-compatible: `/models`, SSE chat completions, ordinary/secret headers, aliases, and capability overrides.
- Anthropic: Messages API SSE with normalized text, usage, cancellation, and errors.

Every selected model is scoped to its provider connection. Same-named models on different profiles do not collide.

## Connection workflow

Open LGS Settings, choose **Models & Providers**, and add or edit a profile. Test & discover performs a real adapter request. A failed endpoint remains visibly failed; LGS does not synthesize models or a connected state. The sidebar uses the configured default connection/model when available and otherwise chooses the first enabled profile and discovered model.

Do not put credentials in `.lgs/config.yaml`, profile headers, chat prompts, or test fixtures. Use the API-key and secret-header fields so values enter SecretStorage.

## Capabilities and reasoning

Streaming, cancellation, multimodal, system-instruction, usage, and reasoning support are normalized as capability metadata. Reasoning effort is sent only when the selected profile reports support (or an explicit compatible capability override enables it). LGS never exposes hidden chain-of-thought.

## Audit status

The 2026-08-27 audit exercised the default Ollama profile in a real Extension Development Host. No Ollama server/model was available, and both sidebar discovery and Settings Test & discover correctly returned `fetch failed`. Adapter parsing, streaming, cancellation, custom headers, and usage normalization are covered by automated mock/local tests, but a real streamed model response remains externally blocked and must not be reported as passed.

