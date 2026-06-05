# Mystery Blueprint Judge — Harness Workspace

You are running in a one-shot judge workspace. You are evaluating **one
quality dimension** of a generated Blueprint V2 mystery. Your only job is to
produce **one** `verdict.json` that passes the validator. Stop when validation
passes.

## Files in this workspace

- `./dimension-id` — single-line text file naming the dimension you are
  judging (e.g. `solve_depth`, `fairness`, `timeline_coherence`,
  `knowledge_coherence`, `character_grounding`).
- `./dimension.md` — the dimension definition: what's being asked, how to
  judge it, and the required output shape. **Read first.**
- `./brief.json` — the story brief that was given to the generator.
- `./blueprint.json` — the full Blueprint V2 JSON produced by the generator.
  This is your evidence base.
- `./context.json` — per-dimension context from the dimension registry
  (`evaluation/dimensions/registry.json`). Empty object `{}` if the dimension
  has no context. For `character_grounding`, this contains `probe_topics`.
- `./prompts/judge-system.md` — the shared judge system prompt (preamble
  shared across all dimensions).
- `./schema/output-schema.ts` — the Zod schema your `verdict.json` must
  match.
- `./docs/` — per-dimension curated context (only present for dimensions
  that need it; e.g. `runtime-consumption.md` for `character_grounding`).
- `./scripts/validate-judge-output.mjs` — the validator. Usage:
  `node scripts/validate-judge-output.mjs ./verdict.json`. Exits 0 on pass,
  non-zero on fail. Runs a **shape check** (Zod against the dimension's
  output schema) followed by **semantic reference / coverage checks** (every
  id you cite exists in `blueprint.json`; topics come from `probe_topics`;
  required coverage). Prints all failures.

## Mandatory iteration protocol

1. **Read inputs.** `dimension.md` first, then `brief.json` and
   `blueprint.json`. Skim `context.json`, `prompts/judge-system.md`,
   `schema/output-schema.ts`, and any docs in `docs/`.
2. **Judge.** Apply the dimension's judging procedure to the blueprint.
   Ground every claim in concrete blueprint fields, IDs, or clue texts.
3. **Write the verdict.** Save to `./verdict.json` as a single JSON object
   matching `schema/output-schema.ts`. No markdown fences, no prose before
   or after the JSON.
4. **Validate.** Run `node scripts/validate-judge-output.mjs ./verdict.json`.
5. **If validation fails:** read every reported issue (schema and/or
   reference), edit `./verdict.json` in place, re-run the validator. Repeat
   until it passes.
6. **When validation passes:** stop. The harness reads `./verdict.json`
   after you exit.

## Success criterion

Validator exit code 0. Nothing else counts.

## Hard rules

- **The dimension definition is authoritative.** Follow its judging
  procedure literally. If the prose says "pass iff every X passes", that's
  what the overall `verdict` field means.
- **Use real IDs.** Every `character_id`, `solution_path` id, etc. you
  reference in your verdict must exist in `blueprint.json`. The validator
  checks this. Do not invent ids that "sound right".
- **For `character_grounding`:** every `topics[].topic` you list must be
  copied verbatim from `context.probe_topics`. Do not paraphrase the topic
  text. Cover every character in `blueprint.world.characters`.
- **For `fairness`:** cover every non-culprit character in
  `blueprint.world.characters`. The validator rejects partial coverage.
- **For `solve_depth`:** include one `paths[]` entry per
  `blueprint.solution_paths[]` entry, with the matching `id`. Every clue id in
  `necessary_clues` must be a real blueprint clue, and `shortest_path_id` must
  be one of those path ids (or `null`).
- **Be terse in `reasoning` fields.** Bullet-equivalent prose. Long
  explanations dilute signal.
- **No markdown code fences** in `verdict.json`. The file must be a single
  JSON object, parseable by `JSON.parse`.
- **Do not change the blueprint.** Read-only. Your output is `verdict.json`
  only.

## Tools you should use

- `Read` — for inputs (dimension.md, brief, blueprint, schema, docs).
- `Write` / `Edit` — for drafting and revising `./verdict.json`.
- `Bash` — only for running `node scripts/validate-judge-output.mjs
  ./verdict.json`. Do not run other commands.

## Out of scope

Anything outside this workspace. Modifying the blueprint. Re-evaluating
other dimensions. Running tests. Commits. Documentation updates. The
harness is one-shot — when you exit, your work product is whatever is in
`./verdict.json`.
