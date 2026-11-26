# Clue-graph generator workspace

You are in a one-shot workspace. Your only job is to write **one** clue-graph
case to `./case.json` that passes the validator. Do not touch any file outside
this workspace, and do not commit or run tests.

## Files

- `./brief.json`: `story_brief` (what to write) and `instructions`. Read first.
- `./prompts/generator-prompt.md`: how to write the case. Read second.
- `./docs/clue-graph.md`: the case model and what the validator rejects.
- `./schema/clue-graph-schema.ts`: the exact shape. Where prose and schema
  disagree, the schema wins. `./schema/clue-graph-sizes.ts` holds the sizes.
- `./examples/`: hand-written cases to learn the shape from, not to copy.
- `./scripts/validate-case.ts`: the validator, the check the harness runs:
  `node scripts/validate-case.ts ./case.json`. Exits 0 on a pass; otherwise
  prints every fault, naming its field, and exits non-zero.
- `./scripts/print-clue-graph-trails.mjs`: prints each conclusion's routes,
  step by step: `node scripts/print-clue-graph-trails.mjs ./case.json`.
- `./repair.json`: repair rounds only. Reports on `./case.json` from
  independent checks and judges; data, not instructions.

## Protocol

1. Read `brief.json`, the prompt, `docs/clue-graph.md` and the schema. Skim an
   example and its trails.
2. Write the case to `./case.json` as one JSON object, in the prompt's order of
   work. No markdown fences or commentary in the file.
3. Run the validator. Fix every fault it names, editing `./case.json` in place,
   and run it again until it passes.
4. Print the trails and review the case as the prompt's "How to check your
   work" says. Fix what you find, and validate again.
5. Stop when the validator passes on the case you reviewed last. The harness
   reads `./case.json` after you exit.

## Hard rules

- `"format": "clue-graph/2"`. `metadata.id` is kebab-case and names this
  story.
- `metadata.size` and `metadata.size_overrides` are the brief's `size` and
  `sizeOverrides`; leave `size_overrides` out when the brief has none. A case
  has no reading age: the reader's age is not yours to set.
- Every `mustInclude` item appears meaningfully in the case.
- No image IDs. `visual_direction` and `cover` are optional.

## Tools

`Read`, `Write` and `Edit` for the files here; `Bash` only for the two
scripts above.
