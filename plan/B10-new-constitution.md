# Mystery Game Constitution

## What we are building
We are building a text-based, AI driven, interactive mystery game for young children

## Core Principles

### I. Always load and review core project documentation.
Load and review core project documentation as defined in AGENTS.md.

### II. Test Everything You Build (NON-NEGOTIABLE)
* Always follow the testing guidelines from docs/testing.md.
* Write unit tests for every public function or method, covering happy path and edge cases.
* Write e2e tests for every feature interacting with database and for every API method.
* Write e2e tests for all key user journyes. Identify new key user journeys when evaluation new features.
* Write browser tests for visual features and for key user journeys.

### III. Run Quality Gates
* Always follow the quality guidelines from docs/testing.md.
* Before finalizing any work, all Quality Gates MUST be executed and pass
* Non exhaustive list:
    * Linting
    * Type Checking
    * Unit Tests
    * Integration Tests
    * E2E Tests
* Never bypass these checks. 

### IV. Architecture & Security Constraints
Ensure you follow the archtiectural constraints from docs/architecture.md.

### V. Context-Specific Conventions
Ensure you load relevant convention files based on the type of task being executed. Follow the guidelines in AGENTS.md.

### VI. Observability and logging
Ensure sufficient observability and logging is in place for every new feature. 
* Errors should be logged, ideally once, with full detail. It is critical that they are logged AT LEAST ONCE. Don't swallow errors.

## Development Workflow

- All work should follow the AI Agent Guidelines detailed in `AGENTS.md`.
- Changes MUST be summarized clearly for user review.
- Complexity must be justified and documented explicitly if deviating from standard architectural patterns.

## Governance

This Constitution supersedes all other practices. Amendments require documentation, approval, and a migration plan if necessary. All PRs and code reviews MUST verify compliance with these core principles. Use `AGENTS.md` and `docs/` for runtime development guidance.
