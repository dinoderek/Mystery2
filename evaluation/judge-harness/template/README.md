# Judge workspace

A one-shot workspace created by the evaluation pipeline to run a Claude
agent as a single-dimension judge. Each `evaluateDimension` call produces a
workspace under `~/mysteryevals/<run-date>/<run-stamp>/evaluators-<brief>/<dimension>/`.
All dimensions for one run share the `evaluators-<brief>` parent, and every run
gets its own `<run-stamp>` subtree, so prior runs are never overwritten.

## Layout

```
.
├── CLAUDE.md                          Harness instructions (read by the agent)
├── README.md                          This file
├── dimension-id                       One-line text: the dimension id
├── dimension.md                       Symlink: dimension definition
├── brief.json                         Copied: the story brief
├── blueprint.json                     Copied: the full Blueprint V2
├── context.json                       Copied: per-dimension context ({} if none)
├── verdict.json                       Written by the agent
├── prompts/
│   └── judge-system.md                Symlink: shared judge preamble
├── schema/
│   └── output-schema.ts               Symlink: dimension's Zod output schema
├── docs/                              (only for dims that need extra context)
│   └── runtime-consumption.md         Symlink: curated runtime narrator doc
│                                                (character_grounding only)
└── scripts/
    └── validate-judge-output.mjs      Symlink: schema + reference validator
```

## Symlinks vs copies

- **Symlinks** to authoritative repo artifacts:
  `prompts/judge-system.md`, `schema/output-schema.ts`, `dimension.md`,
  `scripts/validate-judge-output.mjs`, any per-dim docs. Edits to these
  flow into the next eval run.
- **Copies** of per-run inputs: `brief.json`, `blueprint.json`,
  `context.json`. Each run gets its own snapshot.
- **Copies** of harness static files: `CLAUDE.md`, `README.md`.

## Pruning

Workspaces accumulate. Prune with:

```
rm -rf ~/mysteryevals/<run-date>/<run-stamp>/evaluators-<brief>        # one run's evaluators
rm -rf ~/mysteryevals/<run-date>/<run-stamp>/evaluators-<brief>/<dim>  # one dimension
rm -rf ~/mysteryevals/<run-date>/<run-stamp>/                          # one run
```
