# SDD: When and How to Use It

## What This Is

Spec-Driven Development (SDD) is a lightweight workflow for building features using AI agents. You write a short problem definition, the agent researches and drafts a spec, you refine it together, then the agent executes against the spec in discrete tasks.

The workflow is agent-agnostic. It works with Claude Code, Codex, Gemini, or any frontier agent with file system access.

## When to Use SDD

| Situation | Use SDD? |
|---|---|
| Quick bug fix or one-file change | No — just prompt directly |
| Exploring an idea, don't know what you want yet | No — explore first, then write a problem.md if it grows |
| Feature touching 3+ files or components | **Yes** |
| New service integration | **Yes** |
| Cross-cutting change (auth, schema, architecture) | **Yes** |
| You've restarted the same task twice | **Stop and write a problem.md** |

## How to Use It

### Step 0: Create a branch

Create a feature branch. The branch name should match the spec folder name:

```bash
git checkout -b sdd/{feature-name}
```

All SDD artifacts and implementation happen on this branch.

### Step 1: Write `problem.md` (you, 10 minutes)

Copy the template from `docs/sdd/templates/problem.md`. Fill it in. Two sections matter most:

- **Existing Context** — reference specific files (skills, code, migrations). This connects the agent to the project's knowledge.
- **Research Threads** — define 3-6 specific questions you want investigated. You direct the research, not the agent. Be specific: "What OAuth2 patterns does HMRC use?" not "How does auth work?"

Save it in `docs/sdd/specs/{feature-name}/problem.md`.

### Step 2: Research (agent, parallel)

Give the agent the orchestrator prompt `docs/sdd/prompts/1A.research.md`. The agent reads your problem definition, extracts your research threads, and dispatches each one to a sub-agent in parallel. Each sub-agent gets a clean context with only the problem summary and its own thread question — no cross-contamination.

Once all threads complete, the orchestrator synthesises findings into a single `research.md`.

**Your checkpoint:** Read the research. Key questions:
- Do the findings match your understanding? Where do they differ?
- Are there conflicts between threads? (Good — these are real design decisions.)
- **Does the Problem Reframe section flag issues with your problem definition?** If so, update problem.md before moving on. Don't anchor to a mis-framed problem.

### Step 3: Specify (agent)

Give the agent the specification prompt `docs/sdd/prompts/2.specify.md`. The agent reads problem.md and research.md from the specs directory and produces `spec.md`.

**Your checkpoint:** Does the overview match your intent? Do you agree with design decisions? Are constraints complete? Are success criteria testable?

### Step 4: Refine (agent interviews you)

Give the agent the refinement prompt `docs/sdd/prompts/3.refine.md`. The agent reads the spec and asks you questions to surface hidden assumptions. It produces an updated `spec.md`.

**Your checkpoint:** The spec should feel precise. No vague language ("handle appropriately", "as needed"). If you see any, do another round.

### Step 5: Plan tasks (agent)

Give the agent the planning prompt `docs/sdd/prompts/4A.plan.md`. It reads the spec and produces `tasks.md`.

**Your checkpoint:** Are tasks the right granularity? Each should be 15-60 minutes of agent work, independently testable, and have a clear "done when" condition.

### Step 6: Execute (agent, per task)

For each task, give the agent the execution prompt `docs/sdd/prompts/4B.execute.md` with the feature name and task number. Ideally each task runs in a fresh agent session to prevent context drift.

**Your checkpoint after each task:** Does the output match the task? Did quality gates pass? Did the agent flag any blockers?

### Step 7: PR and merge

When all tasks are complete, create a PR from `sdd/{feature-name}` to main. The PR includes both the implementation and the spec artifacts. After merge, the spec remains in `docs/sdd/specs/{feature-name}/` as permanent historical record.

Update the spec's status field to `implemented` before merging.

## Git Workflow

```
main
 └── sdd/{feature-name}          ← branch for this spec
      ├── Phase 0-3: spec work   ← commits: problem.md, research.md, spec.md, tasks.md
      ├── Phase 4B: execution    ← commits: implementation + tests per task
      └── PR → main              ← spec + code merge together
```

**Branch naming:** `sdd/{feature-name}` — matches the folder under `docs/sdd/specs/`.

**Commit convention:** Use conventional commits. Spec artifacts use `docs(sdd):`, implementation uses `feat(scope):` or `fix(scope):` as normal.

**PR:** The PR covers everything — spec artifacts and implementation code. Reviewers can see the spec that drove the implementation.

**After merge:** Spec files stay in `docs/sdd/specs/{feature-name}/` on main. They're historical artifacts, not active documentation. Don't reference them from architecture docs or CLAUDE.md — they're for "why did we build it this way?" questions, not "how does it work?" questions.

## Directory Structure

```
sdd/
├── guide.md              ← You are here
├── design.md             ← Why each phase exists
├── templates/            ← Input/output templates
│   ├── problem.md
│   ├── research.md
│   ├── spec.md
│   └── tasks.md
├── prompts/              ← Agent prompts for each phase
│   ├── 1A.research.md
│   ├── 1B.research-thread.md
│   ├── 1C.research-synthesize.md
│   ├── 2.specify.md
│   ├── 3.refine.md
│   ├── 4A.plan.md
│   └── 4B.execute.md
└── specs/                ← All feature specs (permanent)
    └── {feature-name}/
        ├── problem.md    ← Phase 0 (human-written)
        ├── research.md   ← Phase 1 (agent-produced)
        ├── spec.md       ← Phase 2-3 (agent-produced, human-refined)
        └── tasks.md      ← Phase 4A (agent-produced)
```

## Spec Status

Each `spec.md` has a status field in its header:

| Status | Meaning |
|---|---|
| `draft` | Spec is being written (Phases 0-3) |
| `ready` | Spec is approved, execution can begin (Phase 4) |
| `in-progress` | Execution is underway |
| `implemented` | All tasks complete, merged to main |
| `abandoned` | Spec was not implemented — record why |

## Rules

1. **Never skip Phase 0.** The problem definition is the seed. Bad seed, bad tree.
2. **Each task must run quality gates** (`npm run test:all`) before being marked done.
3. **Documentation must be updated** as part of execution, not as an afterthought.
4. **The spec is the source of truth** during implementation. If the spec is wrong, update the spec first, then the code.
5. **Research can reframe the problem.** If research reveals problem.md is wrong, update it before specifying. Don't anchor.
6. **Specs are permanent.** They merge to main alongside implementation and stay in the repo. They're history, not documentation.
