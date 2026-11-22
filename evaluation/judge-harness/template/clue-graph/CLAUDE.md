# Clue-Graph Case Judge — Harness Workspace

You are running in a one-shot judge workspace. You are evaluating **one
quality dimension** of a clue-graph mystery case. Your only job is to produce
**one** `verdict.json` that passes the validator. Stop when validation passes.

## Files in this workspace

- `./dimension-id` — the dimension you are judging (`cg_soundness`,
  `cg_truth_agreement`, `cg_character_grounding` or `cg_step_sense`).
- `./dimension.md` — the dimension definition: what is asked, how to judge
  it, and the output. **Read first.**
- `./prompts/judge-system.md` — the preamble every clue-graph judge shares: the
  case format, and what code already checks.
- `./case.json` — the case. This is your evidence base.
- `./player_view.json` — for `cg_step_sense` only: the case's waves and steps,
  derived by code.
- `./context.json` — per-dimension context from the registry; `{}` if none.
- `./schema/output-schema.ts` — the Zod schema `verdict.json` must match.
- `./scripts/validate-judge-output.ts` — the validator:
  `node scripts/validate-judge-output.ts ./verdict.json`. It checks the shape,
  then that every id you cite exists in `case.json` and that you cover what you
  must (every conclusion, character or step). Exits 0 on pass.

## Mandatory iteration protocol

1. **Read inputs.** `dimension.md`, then `prompts/judge-system.md`, then
   `case.json` (and `player_view.json` when present). Skim the schema.
2. **Judge.** Follow the dimension's procedure. Ground every finding in the
   case's ids and quote the fact at fault.
3. **Write** `./verdict.json`: one JSON object matching the schema, with no
   fences and no prose around it.
4. **Validate** with the command above.
5. **If it fails,** read every issue, edit `./verdict.json` in place and run
   it again, until it passes.
6. **When it passes,** stop. The harness reads `./verdict.json` after you exit.

## Hard rules

- The dimension definition is authoritative.
- Use real ids from `case.json`. Do not invent ids that sound right.
- `verdict` is `fail` exactly when a finding is `major`.
- Be terse. Do not change the case. Use `Read`, `Write` and `Edit` for files,
  and `Bash` only to run the validator.
