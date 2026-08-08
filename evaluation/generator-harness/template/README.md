# Generator workspace

This is a one-shot workspace created by the evaluation pipeline to run a
Claude agent as a blueprint generator. Each evaluation pipeline run produces
a fresh workspace under `~/mysteryevals/<run-date>/<run-stamp>/generator-<brief>/`.
Every run gets its own `<run-stamp>` subtree, so prior runs are never
overwritten or deleted.

## Layout

```
.
├── CLAUDE.md                       Harness instructions (read by the agent at start)
├── README.md                       This file
├── brief.json                      Written by the harness: story_brief + instructions
├── blueprint.json                  Written by the agent: the generated blueprint
├── prompts/
│   └── generator-prompt.md         Symlink to repo: authoritative creative prompt
├── schema/
│   └── blueprint-schema-v2.ts      Symlink to repo: authoritative Zod schema
├── docs/
│   ├── game-overview.md            Curated extract: how blueprints become play
│   ├── runtime-consumption.md      Curated extract: how the runtime AI uses your blueprint
│   └── briefs.md                   Curated extract: story_brief field reference
└── scripts/
    └── validate-blueprint.mjs      Symlink to repo: schema validator
```

## What lives here vs in the repo

- **Symlinked from the repo:** schema, prompt, validator. These are the
  authoritative artifacts. Edits to them in the repo flow into all subsequent
  workspaces.
- **Copied from `evaluation/generator-harness/template/`:** `CLAUDE.md`,
  `README.md`, and `docs/`. These are workspace-static, so an in-flight
  workspace is unaffected if you edit the template mid-run.

## Curated docs sync

Each curated doc carries the git blob hash of every source it was derived from.
`npm run check:curated-docs` recomputes those hashes and fails on drift. It runs
as part of Phase 1 of the `npm test` gate, so a source edit that outdates a
curated extract fails the gate.

When it reports drift, **regenerate the affected extract against its current
source and update the hash together**. Bumping the hash alone is not a fix — the
header's claim is "this extract was derived from the source at this blob", so a
refreshed hash over stale prose turns a true positive into a permanent silent
false negative.

## Pruning

Workspaces accumulate. Prune with:

```
rm -rf ~/mysteryevals/<run-date>/<run-stamp>/generator-<brief>   # one generator
rm -rf ~/mysteryevals/<run-date>/<run-stamp>/                     # one run (generators + evaluators)
rm -rf ~/mysteryevals/<run-date>/                                 # one day
rm -rf ~/mysteryevals/                                            # all runs
```
