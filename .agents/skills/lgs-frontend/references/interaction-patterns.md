# LGS Interaction Patterns

## Composer

The message composer is the command surface of the product.

It should support a compact layout similar in structure to mature coding agents:

    ┌──────────────────────────────────────────────┐
    │ Ask LGS to do something...                   │
    │                                              │
    │ +   Context   │ Model · Reasoning │ Mode  ↑ │
    └──────────────────────────────────────────────┘

Control groups should use subtle separators.

## Attachments

Use a + button to add context.

Supported items may include:
- files
- folders
- images
- repository resources
- pasted content
- URLs where supported

Attachments should become visible as compact removable items.

Do not require users to remember what they attached.

## Context meter

Show context usage compactly, preferably as a small circular meter.

Hover/focus:
    32,481 / 128,000 tokens

Click may expose:
- conversation
- repository context
- attachments
- tool/system overhead

Only show actual data when available.

Never fake precision.

## Model

Show active model directly in the composer.

Clicking it opens model selection.

Do not require opening settings for routine model changes.

## Reasoning

Show reasoning/thinking level next to the model when the provider supports it.

Do not display unsupported controls.

## Modes

Modes are behavior contracts, not decoration.

Expected modes may include:
- Normal
- Plan
- Web
- Research

Mode selection should be compact and accessible from the composer.

## Working status

While work is active, show one persistent overall timer:

    Working · 4m 28s                         Details
    ──────────────────────────────────────────────

The timer represents elapsed time for the current user-request lifecycle,
including all phases/subtasks.

Do not repeatedly reset the visible top-level timer for every internal phase.

## Details view

Clicking Details should reveal a compact phase history.

Example:

    Working · 4m 28s

    ✓ Understand request             0:18
      Goal: determine intended behavior and constraints

    ✓ Inspect architecture           0:52
      Goal: find affected runtime and UI systems

    ✓ Plan implementation            0:31
      Goal: determine changes and verification strategy

    ● Implement changes              2:41
      Goal: build provider lifecycle and composer architecture

    ○ Verify
      Goal: run tests and inspect UI

    [Open activity log]

Phase names should be useful abstractions, not raw chain-of-thought.

## Activity log side panel

"Open activity log" opens a secondary VS Code panel/webview beside the
conversation.

The log can provide substantially more operational detail, such as:

    15:42:11  Inspecting provider registry
    15:42:16  Read src/providers/ollama.ts
    15:42:22  Found existing health-check abstraction
    15:42:41  Updating lifecycle manager
    15:43:05  Running extension tests
    15:43:18  Test failure: expected provider state
    15:43:47  Correcting initialization ordering
    15:44:09  Tests passed

This is an execution/event trace, not hidden chain-of-thought.

Good activity entries describe:
- actions
- files inspected
- tools invoked
- tests run
- errors encountered
- state changes
- verification results
- high-level decisions

Do not expose private reasoning tokens or hidden chain-of-thought.

## Error states

Errors should be compact and actionable.

Prefer:

    Ollama unavailable
    Connection refused · localhost:11434
    [Restart] [Settings] [Details]

over a large persistent alert.

## Empty state

Keep the empty state minimal.

Prefer:
    Ask LGS to do something...

Optionally include a few very compact command suggestions.

Do not create a marketing hero.