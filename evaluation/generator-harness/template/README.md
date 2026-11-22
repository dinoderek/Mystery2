# Generator workspace

A one-shot workspace in which a Claude agent generates a blueprint or a
clue-graph case. Each run gets a fresh one under
`~/mysteryevals/<run-date>/<run-stamp>/generator-<brief>/`, never overwriting
an earlier run.

## Layout

```
.
├── CLAUDE.md                       Harness instructions (read by the agent at start)
├── README.md                       This file
├── brief.json                      Written by the harness: story_brief + instructions
├── blueprint.json                  Written by the agent: the generated blueprint
├── repair.json                     Repair rounds only: reports to fix
├── prompts/
│   └── generator-prompt.md         Copy of the prompt the pipeline rendered: canonical creative prompt + age guidance
├── schema/
│   └── blueprint-schema-v2.ts      Symlink to repo: authoritative Zod schema
├── docs/
│   ├── game-overview.md            Curated extract: how blueprints become play
│   ├── runtime-consumption.md      Curated extract: how the runtime AI uses your blueprint
│   └── briefs.md                   Curated extract: story_brief field reference
└── scripts/
    └── validate-blueprint.ts      Symlink to repo: schema, mechanical-check and reading-grade validator
```

A clue-graph workspace (`setup-workspace.sh <dir> clue-graph`) holds
`clue-graph/CLAUDE.md`, `brief.json`, the agent's `case.json`, `repair.json`,
the rendered prompt and a copy of `docs/clue-graph.md`, with links to the case
schema and sizes, the hand-written cases (`examples/`), `validate-case.ts` (the
case's mechanical check, brief included) and `print-clue-graph-trails.mjs`.

## What lives here vs in the repo

- **Symlinked from the repo:** schema, validator, so repo edits reach the
  next workspace.
- **Written per run:** `prompts/generator-prompt.md` is a copy of the prompt the
  pipeline rendered for the brief's `targetAge`, so it holds the age section.
  Run by hand without a rendered prompt, the wrapper leaves a symlink to the
  canonical prompt, which lacks that section.
- **Copied from `evaluation/generator-harness/template/`:** `CLAUDE.md`,
  `README.md`, and `docs/`. These are workspace-static, so an in-flight
  workspace is unaffected if you edit the template mid-run.

## Curated docs sync

Each curated doc pins the sources it was derived from. A pin is either a whole
file (its git blob hash) or one marked section of a doc:

```
> - `docs/game.md#commands` — `<sha>`
```

pins only the text between `<!-- extract:commands -->` and
`<!-- /extract:commands -->` in `docs/game.md`, hashed with whitespace
collapsed, so an edit elsewhere in the doc — or a re-wrap — does not count.
`npm run check:curated-docs` recomputes every pin as part of phase 1 of the
`npm test` gate. It also fails on a malformed marker, or a marked section no
extract pins.

On drift it prints the last commit at which the pin held; review
`git diff <commit> -- <source>` against the extract, **update the extract if it
no longer holds**, then record the new hash. Bumping the hash alone is not a
fix — the pin's claim is "this extract was checked against the source as it is
now", so a refreshed hash over stale prose turns a true positive into a
permanent silent false negative.

To pin a new part of a doc, wrap it in a marker pair with a new id and add the
pin to the extract's header.

## Pruning

Prune with `rm -rf` on one
`~/mysteryevals/<run-date>/<run-stamp>/generator-<brief>`, a run stamp, a day
or `~/mysteryevals/` itself.
