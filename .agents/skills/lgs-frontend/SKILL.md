---
name: lgs-frontend
description: Design and implement the LGS VS Code extension UI as mature, information-dense developer tooling. Use whenever changing LGS webviews, chat UI, settings, provider management, activity/status presentation, interaction patterns, layout, styling, or frontend architecture.
---

# LGS Frontend

Use this skill whenever modifying the visible LGS product.

LGS is a professional software engineering agent embedded in VS Code.

It is a TOOL, not a marketing experience.

The interface should prioritize:
- work
- state
- context
- actions
- evidence
- activity
- compact controls

over:
- explanation
- branding
- decorative surfaces
- onboarding copy
- AI-themed presentation

Before implementing frontend work, read:

- `references/visual-language.md`
- `references/interaction-patterns.md`
- `references/anti-patterns.md`

## Core product principle

Prefer showing what LGS is doing over telling the user what LGS is.

Do not add explanatory UI when an interaction, state indicator, tooltip,
details view, or discoverable control can communicate the same information.

## Workflow

For any meaningful frontend change:

1. Inspect the existing component hierarchy.
2. Identify components that should be removed rather than layered over.
3. Determine the primary information hierarchy.
4. Implement the smallest coherent interaction architecture.
5. Run the extension.
6. Visually inspect it inside VS Code.
7. Test narrow and wide sidebar/panel widths.
8. Inspect empty, loading, active, success, warning, and failure states.
9. Remove unnecessary chrome and duplicated information.
10. Iterate until it looks intentionally designed rather than merely functional.

Do not stop at "the feature works."

## Information hierarchy

Default priority:

1. Current conversation/work
2. Current agent state
3. User input
4. Current context
5. Model/mode/runtime controls
6. Supporting history/details
7. Branding

Branding should never compete with the task.

## Interaction philosophy

Controls should generally be discoverable through:
- familiar icons
- concise labels
- tooltips
- expandable details
- secondary panels

Avoid persistent explanatory paragraphs.

## Quality test

Before completion, ask:

- Does every visible element earn its space?
- Is important runtime state obvious?
- Can the user understand what LGS is doing?
- Are controls where a developer would expect them?
- Are there unnecessary cards or containers?
- Is the same information displayed twice?
- Does this look like a mature IDE tool?
- Would removing text make the interface clearer?
- Does the feature work at narrow VS Code widths?
- Did I inspect the actual rendered extension rather than reasoning only from code?

If not, continue iterating.