# Planning, Research, and Long-Running Sessions

LGS separates a task's **mode** from its **capabilities**. A mode controls how the Advisor approaches work; capabilities control which tool families are available. Enabling Research mode does not enable Web, and enabling Web does not cause automatic research.

The composer modes are Chat, Plan, Implement, Research, and Review. Plan inspects repositories, Git, dependencies, external documents, and permitted web sources while blocking code, command, and system mutation by default. Review permits bounded evidence and independent-review operations without implementation writes. Capabilities are independently selectable for Web, Code, Terminal, Browser, Computer, and Integrations.

## Reasoning selection

Reasoning selection is normalized as Auto, Low, Medium, or High. Auto omits provider-specific reasoning parameters. Low, Medium, and High are sent only when the selected backend advertises reasoning support. The composer reports unsupported or unknown support rather than assuming a provider implements a parameter.

## Auto Research and enforcement

Auto Research has three settings:

- Off initiates research only when requested explicitly or forced by another configured rule.
- When uncertain creates a persistent research requirement after explicit uncertainty, unfamiliar behavior, a version-sensitive or unsupported external assumption, or a Watchdog `NEEDS_RESEARCH` finding.
- Proactive also prefers authoritative checks before significant external or version-sensitive decisions.

Web capability answers whether research tools may access external sources. Auto Research answers when LGS initiates research. It never turns Web on implicitly.

Watchdog observes agent statements and task state. Under an active Auto Research policy, uncertainty or version-sensitive external assumptions create `.lgs/tasks/<task-id>/research-requirements.json`. A deterministic execution guard blocks mutating tools until a later research result with provenance satisfies the requirement. Repository inspection and research tools remain available. If Web is disabled, the barrier explains that the user must enable Web or provide authoritative task evidence.

## Planning Mode and `PLAN.md`

Planning Mode writes only its own task artifacts. A plan is stored as structured `plan.json` and rendered to `.lgs/tasks/<task-id>/PLAN.md` with the objective, acceptance criteria, current understanding, proposed approach, expected files or areas, stages, verification, risks, and open questions.

Plans choose either `wait-for-approval` or `implement-automatically`. The Plan view can open, approve, regenerate, or begin implementation. A wait-for-approval plan cannot begin implementation until it is approved. Regeneration and revisions append a dated explanation and supporting evidence; historical rationale is not silently replaced.

The tool executor is the hard Plan Mode boundary. Read-only repository, Git, and inspection tools plus configured web research remain available. Only `create_plan_task` and `revise_plan` may persist project changes. Source edits, command execution, Git mutation, and indirect LGS-managed writes return `Write blocked by Plan Mode. Only the active plan artifact may be modified while planning.` Tool names do not bypass the permission check. The default artifact root is `.lgs/tasks`, and `PlanningArtifactStore` accepts a safe workspace-relative alternative for integrations that establish another convention.

Beginning implementation preserves the plan, changes the active mode, removes the source-write restriction for later tool calls, and records a request activity transition. Standalone Plan Mode waits for approval when its handoff is `wait-for-approval`; Research may use `implement-automatically`.

## Research Mode and the Research Notebook

`ResearchCycleEngine` persists raw cycle and experiment state in `research-cycles.json` and renders `.lgs/tasks/<task-id>/RESEARCH.md`. Each cycle records the research question, current evidence, hypothesis, confidence, proposed experiment, expected and actual observations, analysis, conclusion, and next action. Conclusions are `SUPPORTED`, `REJECTED`, `PARTIAL`, or `INCONCLUSIVE`.

Evidence claims are explicitly classified as `CONFIRMED`, `STRONG`, `WEAK`, `HYPOTHESIS`, or `REJECTED` and retain provenance. Only confirmed or strong evidence is rendered as an established fact. A failed or inconclusive experiment still records its observation and learning.

The concise notebook contains established facts, uncertain claims, hypotheses, sources, experiment summaries, rejected approaches, the best current explanation, unknowns, and the current recommendation. A restarted extension reconstructs it from disk rather than depending on an earlier model transcript.

### Novelty and supervision

Before starting an experiment, the engine compares normalized hypothesis and experiment terms against failed experiments. A materially equivalent retry returns `REPEATED_APPROACH`, identifies the earlier experiment and result, and requires either a different hypothesis or explicit new-evidence justification.

The read-only `ResearchSupervisor` checks hypothesis-to-experiment alignment, observations, evidence strength, drift, and progress. It cannot implement changes. Manager can delegate compact branches to official-documentation researchers, source researchers, repository explorers, experiment implementers, result analyzers, or the research supervisor.

### Budgets and completion

Research budgets cover maximum cycles, consecutive failed cycles, elapsed minutes, optional tokens and cloud cost, and minimum progress frequency. Exhaustion pauses the notebook and preserves the best explanation, completed experiments, blockers, recommendation, and next escalation action. It does not claim success.

Research-profile Completion Guard requires a completed, experiment-backed `SUPPORTED` or `PARTIAL` conclusion plus confirmed or strong evidence. Model confidence alone cannot satisfy the gate.

## Context compaction and rotation

Context lifecycle defaults are 70% soft pressure, 82% compaction, and 92% rotation. They are configurable under `context.lifecycle` in `.lgs/config.yaml` and must increase monotonically.

- Soft pressure increases retrieval discipline.
- Compaction marks completed interaction history for removal while retaining task artifacts and records saved tokens.
- Rotation requires a validated checkpoint, creates a fresh logical session ID, and returns a minimal reconstruction message through durable task knowledge.

Checkpoints persist established facts, decisions, the current hypothesis and experiment, modified files, failed approaches, unresolved questions, acceptance status, and the next action. Rotation increments its count and never ends the task. The UI reports current and maximum context, compaction, rotations, persistent knowledge size, and saved context without exposing hidden chain-of-thought.

## Attachments and vision

The composer supports multiple files through the picker, drag and drop, and clipboard paste. Removable chips show selections before send. Attachments up to 25 MB are copied into `.lgs/tasks/<task-id>/artifacts/<artifact-id>/`, fingerprinted, and listed in `artifacts.json`.

TXT, Markdown, source, JSON, CSV, PDF, DOCX, and XLSX use the deterministic Phase 27 extraction boundary. Images retain metadata and original bytes. Extracted text larger than the chunk boundary receives a deterministic index and is retrieved selectively by query rather than injected wholesale.

If the primary model lacks vision, an image is marked `pending-delegation`. `VisionRouter` can send only the retained image to an authorized vision-capable analyzer and returns a bounded structured observation to Manager. The original image remains the task artifact.

## BrowserAgent

Browser verification now uses a reusable BrowserAgent for localhost and external HTTP(S) websites. Navigation, rendered-text inspection, input, screenshots, console errors, and failed network requests remain isolated in Playwright. External sites can be disabled with `runtime.browser.externalSites: false`.

Consequential external actions—such as purchase, submit, delete, publish, transfer, or sensitive credential/payment input—use `runtime.browser.consequentialActions` (`always_allow`, `ask`, or `deny`, default `ask`). `ask` requires a modal user confirmation. BrowserAgent records the action, task, URL, result, and concise detail in `.lgs/browser-agent.json`; it does not record entered secret values.
