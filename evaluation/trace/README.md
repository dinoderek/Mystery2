# Game-master trace evaluation pipeline

A harness for judging how well the AI **game master** played a mystery, using
the same machinery as the blueprint evaluation pipeline (`evaluation/`) but with
a played *trace* as the subject instead of a generated blueprint.

**Status:** walking skeleton. Extraction + reconstruction + two checks
(`clue_accounting`, `spoiler_leak` — mechanical) + one judge dimension
(`gm_fabrication`). The remaining judges (character consistency, search
adjudication, accusation correctness, tone) and the failure→fixture replay loop
are designed-for but not yet built.

## Why this exists

The game runtime already persists every played session in Supabase for the
resume feature: a `game_sessions` snapshot plus an append-only `game_events`
log. That is a complete trace of what the game master did. This pipeline turns
that data into a quality signal — where did the game master fabricate, leak the
solution, or mis-handle clues — and a durable artifact you can replay when you
switch models or iterate on a prompt.

## The two stages

```
extract.mjs        run.mjs
  Supabase  ──►  raw trace JSON  ──►  reconstruct (run-time)  ──►  checks + judges  ──►  result.json
```

1. **Extract** (`extract.mjs`) pulls a session out of Supabase — snapshot,
   ordered events, the driving blueprint, and non-secret AI-profile metadata —
   and writes a **raw** trace artifact. Raw is deliberate: it is a faithful
   dump with no derived fields.
2. **Run** (`run.mjs`) takes a raw trace (pre-extracted via `--trace`, or
   extracted inline via `--session`), **reconstructs** what the game master saw
   each turn by replaying the events through the real runtime context builders
   (`supabase/functions/_shared/ai-context.ts`), runs the always-on mechanical
   checks and the judge battery, and writes a `result.json` envelope.

Reconstruction is a run-time step, not baked into the stored artifact, so the
reconstruction logic stays versioned with the code rather than frozen into old
data. (We deliberately do **not** stamp a context version onto traces: the
builders aren't versioned, and a stamp couldn't reproduce a historical prompt
anyway. Re-running always reflects current game-master logic, and the raw trace
is preserved so a re-run is always possible.)

## Quick start

```bash
# 1. (Optional) configure an LLM CLI for the judges. Without this, only the
#    mechanical checks run.
cp evaluation/trace/config/cli.example.json evaluation/trace/config/cli.json

# 2a. Extract a played session to a raw trace artifact:
SERVICE_ROLE_KEY=... npm run eval:trace:extract -- --session <session-id> --out trace.json

# 2b. Evaluate a pre-extracted trace:
npm run eval:trace -- --trace trace.json

# Or do both in one step (extract inline, then evaluate):
SERVICE_ROLE_KEY=... npm run eval:trace -- --session <session-id>
```

Each run writes a self-contained directory under `$MYSTERYEVALS_DIR` (default
`~/mysteryevals`): `result.json`, `reconstruction.json`, the inline-extracted
`trace.json` (when `--session` is used), and per-judge `logs/`.

## Layout

```
evaluation/trace/
├── extract.mjs              # CLI: Supabase session → raw trace artifact
├── run.mjs                  # CLI: raw trace → reconstruct → checks + judges → envelope
├── lib/
│   ├── normalize.mjs        # pure: rows → canonical raw trace artifact
│   ├── datasource.mjs       # Supabase fetch (injectable; pure orchestration over 4 methods)
│   ├── reconstruct.mjs      # run-time: fold session state + per-turn context via real builders
│   ├── mechanical.mjs       # always-on deterministic checks (clue_accounting, spoiler_leak)
│   ├── envelope.mjs         # trace-shaped result envelope (reuses combineDimension)
│   └── load.mjs             # dimension registry + definition loaders
├── dimensions/
│   ├── registry.json        # the judge battery + mechanical context
│   ├── gm-fabrication.md     # judge prompt (prose contract)
│   └── gm-fabrication.schema.ts
├── prompts/
│   └── judge-system.md      # shared system prefix for trace judges
└── config/
    ├── cli.example.json     # copy to cli.json
    └── wrappers/            # bundled judge CLI wrapper (invokes `claude`)
```

## Reuse of the blueprint pipeline

The subject-agnostic machinery is imported, not forked:

- `evaluation/pipeline/cli-runner.mjs` — SDK-free subprocess model calls.
- `evaluation/pipeline/timing.mjs` — monotonic-clock stage/dimension timing.
- `evaluation/pipeline/envelope.mjs` → `combineDimension` — the per-dimension
  pass/fail/error/skipped semantics.

Trace-specific pieces (a trace has no generate stage; the subject already
exists) live under `evaluation/trace/`. Dimensions follow the same convention as
the blueprint battery: one `<id>.md` prose contract + one `<id>.schema.ts` Zod
schema, picked up by id from `registry.json`.

## Checks and dimensions

| Check / dimension | Tier       | Asks |
|-------------------|------------|------|
| `clue_accounting` | mechanical | Every revealed clue id is real and in scope; bare-search reveals stay an ordered, non-repeating prefix of the location's clues. |
| `spoiler_leak`    | mechanical | No pre-accusation narration copies a long *verbatim* run of ground-truth text. Verbatim only (high contiguous-word threshold); paraphrase leakage is a judge's job. |
| `gm_fabrication`  | judge      | Did the game master invent material facts the blueprint does not support? |

## Tests

The pipeline is unit-tested under `tests/api/unit/trace-*.test.ts` (normalize,
reconstruct, mechanical, envelope, run orchestration with a mock judge CLI).
They use injected fixtures and a mock CLI, so they need neither a database nor an
LLM and run in the standard unit gate.

## Roadmap

- More judges: character consistency, search adjudication, accusation
  correctness, tone / age-appropriateness.
- Failure → fixture: freeze a flagged turn's reconstructed context as a golden
  fixture and replay it against a different model/prompt to confirm a fix — the
  "switch the model or iterate on the prompt" loop.
- Batch extraction (query a set of sessions) and run-history storage.
