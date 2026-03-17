# Task Breakdown: {Feature Name}

<!-- Phase 4A output. Ordered, dependency-aware task list. -->
<!-- Each task should be completable in a single, fresh agent session. -->

## Phase 1: {Phase Name}

### Task 1.1: {Short Title}

- **Spec sections**: S2, S5.1
- **Description**: {What to do, in 2-3 sentences}
- **Input**: {What must already exist — files, data, prior tasks}
- **Output**: {What this task produces — files, tests, configs}
- **Files affected**: {Specific file paths}
- **Done when**: {Specific, testable condition}
- **Quality gates**: {Which gates apply — lint, typecheck, unit, component, integration, e2e}
- **Doc updates**: {Which docs need updating, if any}
- **Depends on**: {none | Task X.Y}

### Task 1.2: ...

## Phase 2: {Phase Name}

### Task 2.1: ...

---

## Execution Notes

- Run each task in a fresh agent session with `spec.md` + the task description
- After each task: verify "done when" condition, run quality gates, commit
- If a task surfaces a blocker not covered by the spec, stop and update the spec before continuing
