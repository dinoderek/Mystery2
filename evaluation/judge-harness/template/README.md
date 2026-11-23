# Judge workspace

A one-shot workspace created by the evaluation pipeline to run a Claude agent
as a single judge of a clue-graph case. Each judge call produces a workspace
under `~/mysteryevals/<run-date>/<run-stamp>/evaluators-<case>/<judge>/`.
Every run gets its own `<run-stamp>` subtree, never overwritten.

## Layout

```
.
├── CLAUDE.md                          Instructions (clue-graph/CLAUDE.md, read by the agent)
├── README.md                          This file
├── dimension-id                       One-line text: the judge id
├── dimension.md                       Symlink: the judge's brief
├── case.json                          Copied: the case
├── player_view.json                   Copied: for cg_step_sense only
├── context.json                       Copied: per-judge context ({} if none)
├── verdict.json                       Written by the agent
├── prompts/
│   └── judge-system.md                Symlink: the clue-graph judges' preamble
├── schema/
│   └── output-schema.ts               Symlink: the judge's Zod output schema
└── scripts/
    └── validate-judge-output.ts      Symlink: schema + reference validator
```

## Symlinks vs copies

- **Symlinks** to authoritative repo artifacts: `prompts/judge-system.md`,
  `schema/output-schema.ts`, `dimension.md`, `scripts/validate-judge-output.ts`.
  Edits to these flow into the next eval run.
- **Copies** of per-run inputs: `case.json`, `player_view.json`, `context.json`.
- **Copies** of harness static files: `CLAUDE.md`, `README.md`.

## Pruning

```
rm -rf ~/mysteryevals/<run-date>/<run-stamp>/evaluators-<case>        # one run's judges
rm -rf ~/mysteryevals/<run-date>/<run-stamp>/evaluators-<case>/<judge> # one judge
rm -rf ~/mysteryevals/<run-date>/<run-stamp>/                          # one run
```
