<!-- Sync Impact Report:
Version change: initial -> 1.0.0
Modified principles: 
- [PRINCIPLE_1_NAME] -> I. Documentation First
- [PRINCIPLE_2_NAME] -> II. Test Everything You Build
- [PRINCIPLE_3_NAME] -> III. Run Quality Gates
- [PRINCIPLE_4_NAME] -> IV. Architecture & Security Constraints
- [PRINCIPLE_5_NAME] -> V. Context-Specific Conventions
Added sections: None
Removed sections: None
Templates requiring updates: 
- ✅ .specify/templates/plan-template.md 
- ✅ .specify/templates/spec-template.md 
- ✅ .specify/templates/tasks-template.md
-->
# Mystery Game Constitution

## Core Principles

### I. Documentation First
Before starting any significant task, you MUST load and review core project documentation as defined in AGENTS.md.

### II. Test Everything You Build (NON-NEGOTIABLE)
Tests MUST be written and pass for all features. Follow the testing constraints from docs/testing.md.

### III. Run Quality Gates
Before finalizing any work, all Quality Gates MUST be executed and pass: Linting, Type Checking, Unit Tests, Integration Tests, and E2E Tests. Never bypass these checks.

### IV. Architecture & Security Constraints
Ensure you follow the archtiectural constraints from docs/architecture.md.

### V. Context-Specific Conventions
Developers MUST load relevant convention files based on the type of task being executed as defined in AGENTS.md.

## Development Workflow

- All work should follow the AI Agent Guidelines detailed in `AGENTS.md`.
- Changes MUST be summarized clearly for user review.
- Complexity must be justified and documented explicitly if deviating from standard architectural patterns.

## Governance

This Constitution supersedes all other practices. Amendments require documentation, approval, and a migration plan if necessary. All PRs and code reviews MUST verify compliance with these core principles. Use `AGENTS.md` and `docs/` for runtime development guidance.

**Version**: 1.0.0 | **Ratified**: 2026-03-05 | **Last Amended**: 2026-03-05
