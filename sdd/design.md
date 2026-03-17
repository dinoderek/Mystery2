# SDD Framework: Design Document

## Why SDD Exists

AI agents are powerful executors but poor strategists. Given a vague prompt, they'll produce plausible-looking output that drifts from your intent in subtle ways. The drift compounds across files and sessions. By the time you notice, you're debugging the agent's interpretation of your idea instead of building your product.

SDD solves this by front-loading decisions into a written spec before any code is generated. The spec acts as a contract between you (the human who knows what "right" looks like) and the agent (the worker who can execute fast but needs precise instructions).

## Why This Framework Is Different

This isn't a generic SDD toolkit. It's designed for a project that already has:

- **A tech constitution** with explicit architectural principles
- **Layered architecture** with enforced boundaries (routes → services → repositories)
- **Quality gates** that must pass before any work is final
- **Domain skills files** containing regulatory rules and service-specific knowledge
- **Documentation-as-code** culture where docs are kept in sync with implementation

The framework requires agents to read and respect this existing context. Research doesn't start from zero — it starts from the project's accumulated knowledge.

## Phase-by-Phase Design

### Phase 0: Problem Definition

**Why:** Forces the human to articulate what they actually want before the agent starts working. 10 minutes of writing saves hours of rework. The problem definition is deliberately human-written — no AI involved — because the human is the only one who knows the business context, the urgency, and the constraints that aren't in the codebase.

**How:** The human fills in a structured template covering what, who, why, constraints, existing context, success criteria, and explicit exclusions. The template includes a field for referencing existing project docs and skills files — this is what connects SDD to the project's knowledge base.

**Key design decision:** The template asks "What I Don't Want" explicitly. This prevents agents from over-engineering or adding features you didn't ask for — a common failure mode.

**Key design decision:** The template includes a "Research Threads" section where the human defines 3-6 specific questions to investigate. The human directs the research, not the agent. This prevents agents from researching what's easy rather than what's important.

### Phase 1: Research

**Why:** Agents that jump straight to implementation make architectural decisions implicitly. Research forces those decisions to be explicit and reviewable. It also leverages the agent's ability to read and synthesise large amounts of existing code and documentation — something humans find tedious.

**How:** Research is structured as independent, parallel threads. The human defines specific research questions in problem.md. An orchestrator prompt (`1A.research.md`) dispatches each thread to a sub-agent (`1B.research-thread.md`) concurrently, then synthesises findings (`1C.research-synthesize.md`) into a single research document. Each thread runs in an isolated sub-agent — findings from one thread cannot bias another.

**Key design decision: Human-directed research threads.** The human defines what to investigate, not the agent. Default threads (project context, codebase impact) are included in the template but the human adds domain-specific threads tailored to the problem.

**Key design decision: Parallel execution with context isolation.** When an agent researches regulatory requirements and codebase impact in the same context, findings from one thread bias the other. Each thread runs in its own sub-agent with a clean context — no cross-contamination. Both Claude Code and Codex support sub-agents natively.

**Key design decision: Problem reframing.** Research may reveal the problem definition is wrong — mis-scoped, missing context, or framing the wrong problem entirely. The synthesis step explicitly assesses whether problem.md still holds and recommends changes if not. The human checkpoint between research and specification asks: "Does your problem definition still hold?" This prevents anchoring to an inaccurate problem statement.

**Key design decision: File references, not copy-paste.** All prompts reference files by path (`docs/sdd/specs/{feature-name}/problem.md`) rather than asking the human to paste content. This eliminates sync drift, reduces manual effort, and works naturally with agents that have file system access — which is our baseline assumption.

**Key design decision:** Research is read-only. The agent must not write code, create files, or propose solutions during this phase. Pure investigation.

### Phase 2: Specification

**Why:** The spec is the single most important artifact. It survives across agent sessions, team members, and time. A good spec means any agent (Claude, Codex, Gemini) can pick up any task and execute it correctly without needing the original conversation context.

**How:** The agent synthesises problem.md and research.md into a structured specification covering architecture, design decisions, implementation plan, constraints, success criteria, and a task checklist. Every decision includes rationale and rejected alternatives — this prevents future agents from re-litigating settled decisions.

**Key design decision:** The spec template requires explicit sections for "Constraints" and "What NOT to Build". These are the guardrails that keep agents focused. Without them, agents tend to expand scope.

**Key design decision:** Success criteria must be testable. "Should be fast" is rejected. "Page loads in under 2 seconds on 3G" is accepted. This connects directly to the project's testing strategy and quality gates.

### Phase 3: Refinement

**Why:** This is the phase most people skip, and it's the one that saves the most time. Humans have blind spots — they know what they mean but don't always write it down. The agent-as-interviewer pattern surfaces assumptions the human didn't realise they were making.

**How:** The agent reads the spec and asks questions across five categories: data decisions, conflict resolution, pattern selection, failure & recovery, and boundary conditions. After the interview, it produces an updated spec with all clarifications integrated inline.

**Key design decision:** Questions are asked in small batches, not all at once. This gives the human time to think and prevents overwhelm. The agent updates its mental model after each answer.

**Key design decision:** The human can say "use your best judgment" — but the prompt encourages them to think twice, because these edge cases cause mid-implementation pivots.

### Phase 4A: Task Breakdown

**Why:** Large specs can't be executed in a single agent session without context degradation. Breaking work into atomic tasks means each task gets a fresh context window with only the relevant information. Failures are isolated — if Task 7 fails, Tasks 1-6 are unaffected.

**How:** The agent reads the final spec and produces an ordered task list. Each task specifies inputs, outputs, dependencies, affected files, and a testable "done when" condition. Tasks are grouped into phases with dependency ordering.

**Key design decision:** Each task must include which quality gates apply and which documentation needs updating. This integrates SDD with the project's existing quality enforcement.

**Key design decision:** Tasks must be completable in a single agent session. If a task description exceeds ~500 words, it's too big — break it further.

### Phase 4B: Execution

**Why:** Fresh context per task is the key execution principle. Accumulated context across many tasks leads to the agent "forgetting" constraints or mixing up decisions from different parts of the spec. Each task gets a clean session with only the spec and its specific task.

**How:** For each task, the agent receives the spec (or relevant sections) and the task description. It implements only that task, runs quality gates, updates documentation, and reports what it changed and what the next task should know.

**Key design decision:** The execution prompt includes explicit rules: implement only this task, follow spec constraints exactly, stop on ambiguity rather than guessing. The "stop and describe" rule prevents agents from making assumptions that create hard-to-find bugs.

**Key design decision:** After each task, the agent must run `npm run test:all` and list results. This is non-negotiable — it's the project's existing quality gate, not an SDD addition.

## How SDD Connects to Existing Project Infrastructure

| Project Asset | How SDD Uses It |
|---|---|
| `docs/foundations/tech-constitution.md` | Mandatory reading in Research phase. Architectural constraints in Spec phase. |
| `docs/architecture.md` | Research phase reads it. Spec must be consistent with it. |
| `docs/testing.md` | Spec success criteria map to test tiers. Execution runs quality gates. |
| `docs/development-guardrails.md` | Execution phase enforces coding standards. |
| `docs/styling-conventions.md` | Loaded when tasks involve UI work. |
| `docs/component-inventory.md` | Loaded when tasks involve UI components. |
| `docs/screen-navigation.md` | Loaded when tasks involve routing or navigation. |
| `skills/services/*.md` | Research phase reads relevant service skills. Spec references regulatory rules. |
| `npm run test:all` | Every executed task must pass all quality gates. |
| Core documentation | Every executed task must update relevant docs if changes affect them. |
