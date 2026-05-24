# Mystery Blueprint Generator — Harness Workspace

You are running in a one-shot generator workspace. Your only job is to produce
**one** Blueprint V2 JSON file that passes the validator. Stop when validation
passes. Do not commit, do not run tests, do not touch any files outside this
workspace.

## Files in this workspace

- `./brief.json` — the story brief and instructions. **Read first.** Contains
  `story_brief` (the creative brief) and `instructions`.
- `./prompts/generator-prompt.md` — the authoritative creative prompt. **Read
  second.** It tells you how to think about the task.
- `./schema/blueprint-schema-v2.ts` — the authoritative output schema (Zod).
  **Read third.** When the prose in `generator-prompt.md` and this schema
  disagree, **the schema wins.**
- `./docs/game-overview.md` — what the blueprint becomes at play time.
- `./docs/runtime-consumption.md` — how the runtime AI narrator uses each
  field of your blueprint (especially flavor_knowledge, agendas, actual_actions,
  clues — these have real consumers).
- `./docs/briefs.md` — what each `story_brief` field means and how to interpret
  it.
- `./scripts/validate-blueprint.mjs` — the validator. Usage:
  `node scripts/validate-blueprint.mjs ./blueprint.json`. Exits 0 on pass,
  non-zero on fail. Prints all schema issues.

## Mandatory iteration protocol

1. **Read inputs.** `brief.json`, `prompts/generator-prompt.md`,
   `schema/blueprint-schema-v2.ts`. Skim `docs/`.
2. **Draft the blueprint.** Write it to `./blueprint.json` as a single JSON
   object. No markdown fences, no explanation, no commentary anywhere in the
   file.
3. **Validate.** Run `node scripts/validate-blueprint.mjs ./blueprint.json`.
4. **If validation fails:** read every reported issue, edit `./blueprint.json`
   in place, re-run the validator. Repeat until it passes.
5. **When validation passes:** stop. The harness reads `./blueprint.json`
   after you exit.

## Success criterion

Validator exit code 0. Nothing else counts. Do not stop because you "think"
the blueprint is correct.

## Hard rules

- **Schema is authoritative.** If the prompt says one thing and the schema
  says another, follow the schema.
- **Enum values are not negotiable.** Clue `role`, agenda `type`, character
  `sex`, etc. are fixed enums. Read the schema, use only the values it lists.
  Do not invent values that "sound right" (e.g. `physical_evidence`,
  `maintain_false_alibi`, `deny_motive`, `minimize_presence` are not in the
  schema — do not use them even if a separate doc mentions them).
- **`id` at the top level is a UUID.** Generate a fresh one (UUID v4 format).
- **`metadata.art_style` is optional.** If you don't have a value, omit the
  field entirely. Do not set it to `null` — the validator rejects `null`.
- **Brief counts are contracts.** Total `world.characters.length` must equal
  `culprits + suspects + witnesses` from the brief. `world.locations.length`
  must equal `brief.locations`. `red_herrings.length` must equal
  `brief.redHerringTrails`. Mechanical checks downstream will catch
  mismatches.
- **Exactly one culprit.** Even if the brief asks for more, the schema only
  supports one (this is documented in `docs/briefs.md`).
- **Do not output image-id fields.** `metadata.image_id`,
  `world.locations[].location_image_id`, `world.characters[].portrait_image_id`
  are added later by image tooling.
- **Every clue you author must be referenced** by at least one
  `solution_paths[]`, `red_herrings[]`, or `suspect_elimination_paths[]`. The
  mechanical check fails on orphan clues.
- **Every `mustInclude` string** from the brief must appear meaningfully
  somewhere in the blueprint.

## Tools you should use

- `Read` — for the brief, prompt, schema, and docs.
- `Write` / `Edit` — for drafting and revising `./blueprint.json`.
- `Bash` — only for running the validator (`node scripts/validate-blueprint.mjs
  ./blueprint.json`). Do not run other commands.

## Out of scope

Anything outside this workspace. Image generation. Tests. Commits. PRs.
Documentation updates. Provider configuration. The harness is one-shot — when
you exit, your work product is whatever is in `./blueprint.json`.
