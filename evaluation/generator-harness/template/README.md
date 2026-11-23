# Generator workspace

A one-shot workspace in which a Claude agent generates a clue-graph case. Each
run gets a fresh one under
`~/mysteryevals/<run-date>/<run-stamp>/generator-<brief>/`, never overwriting
an earlier run.

## Layout

```
.
├── CLAUDE.md                       Instructions (clue-graph/CLAUDE.md, read by the agent at start)
├── brief.json                      Written by the harness: story_brief + instructions
├── case.json                       Written by the agent: the generated case
├── repair.json                     Repair rounds only: reports to fix
├── prompts/
│   └── generator-prompt.md         Copy of the prompt the pipeline rendered
├── docs/
│   └── clue-graph.md               Copy of the case format's doc
├── schema/
│   ├── clue-graph-schema.ts        Symlink to repo: authoritative Zod schema
│   └── clue-graph-sizes.ts         Symlink to repo: the size bounds
├── examples/                       Symlinks to the hand-written cases
└── scripts/
    ├── validate-case.ts            Symlink to repo: the case's mechanical check, brief included
    └── print-clue-graph-trails.mjs Symlink to repo: the case's trails
```

## What lives here vs in the repo

- **Symlinked from the repo:** schema, validator, examples, so repo edits reach
  the next workspace.
- **Written per run:** `prompts/generator-prompt.md` is a copy of the prompt the
  pipeline rendered. Run by hand without one, the wrapper leaves a symlink to
  the canonical prompt (`packages/blueprint-generator/src/clue-graph-prompt.md`).
- **Copied:** `CLAUDE.md` and `docs/clue-graph.md`, so an in-flight workspace is
  unaffected if you edit them mid-run.

## Pruning

Prune with `rm -rf` on one
`~/mysteryevals/<run-date>/<run-stamp>/generator-<brief>`, a run stamp, a day
or `~/mysteryevals/` itself.
