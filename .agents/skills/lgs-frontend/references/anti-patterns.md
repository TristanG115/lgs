# LGS Frontend Anti-Patterns

Do not generate these patterns unless explicitly required.

## Vibe-coded dashboard patterns

Avoid:
- cards inside cards
- every section having its own border
- excessive border radius
- arbitrary shadows
- decorative gradients
- giant centered illustrations
- oversized empty states
- random badges
- capability pills
- excessive icon use
- fake analytics
- redundant labels

## Marketing copy inside the product

Avoid persistent text such as:
- Repository-aware
- Evidence-gated
- Provider-neutral
- Begin an investigation
- Describe the engineering outcome...
- Research Lab

The product should demonstrate these qualities through behavior.

## Excessive explanation

Do not permanently explain obvious controls.

Bad:
    "Select a model from this dropdown to choose which AI model..."

Good:
    Model: GPT-5.6 Sol

with an appropriate tooltip if necessary.

## Nested surfaces

Bad:

    outer rounded app container
        rounded conversation container
            rounded status card
                rounded status badge

Prefer flat hierarchy with separators.

## Unnecessary whitespace

Never reserve large portions of the VS Code panel for branding or decoration.

Conversation and work state should dominate available space.

## Fake functionality

Do not fabricate:
- token counts
- performance stats
- provider telemetry
- reasoning levels
- phase progress
- health states

If real information is not available, omit it or label the value as unavailable.

## First-pass acceptance

Do not consider frontend work complete simply because:
- it compiles
- buttons function
- tests pass

Rendered visual inspection is required.