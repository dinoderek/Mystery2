# Generator workspace

This is a one-shot workspace created by the evaluation pipeline to run a
Claude agent as a blueprint generator. Each evaluation pipeline run produces
a fresh workspace under `~/mysteryevals/<run-date>/generator-<brief>/`.

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

Each curated doc carries the git blob hash of its source. Run
`node evaluation/generator-harness/scripts/check-curated-docs.mjs` from the
repo to detect drift. CI / `npm test` wiring is intentionally not done yet.

## Pruning

Workspaces accumulate. Prune with:

```
rm -rf ~/mysteryevals/<run-date>/generator-<brief>   # one generator
rm -rf ~/mysteryevals/<run-date>/                     # one run (generators + evaluators)
rm -rf ~/mysteryevals/                                # all runs
```
