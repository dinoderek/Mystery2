# Game-master trace evaluation pipeline

A harness for judging how well the AI **game master** played a mystery, using
the same machinery as the blueprint evaluation pipeline (`evaluation/`) but with
a played *trace* as the subject instead of a generated blueprint.

**Status:** walking skeleton. Extraction + reconstruction + two checks
(`clue_accounting`, `spoiler_leak` — mechanical) + the four-judge game-master
adherence battery (`gm_roleplay`, `gm_clue_discipline`, `gm_fabrication`,
`gm_spoiler`). Those judges are **shared** with the runtime harness — the briefs
and schemas live in `evaluation/judges/` and grade a single replayed interaction
just as well as a whole session (see `evaluation/judges/README.md`). The
remaining judges (search adjudication, accusation correctness, tone) and the
failure→fixture replay loop are designed-for but not yet built.

## Why this exists

The game runtime already persists every played session for the
resume feature: a `game_sessions` snapshot plus an append-only `game_events`
log. That is a complete trace of what the game master did. This pipeline turns
that data into a quality signal — where did the game master fabricate, leak the
solution, or mis-handle clues — and a durable artifact you can replay when you
switch models or iterate on a prompt.

## The two stages

```
extract.mjs        run.mjs
  game.db  ──►  raw trace JSON  ──►  reconstruct (run-time)  ──►  checks + judges  ──►  result.json
```

1. **Extract** (`extract.mjs`) pulls a session out of `game.db` — snapshot,
   ordered events, the driving blueprint, and non-secret AI-profile metadata —
   and writes a **raw** trace artifact. Raw is deliberate: it is a faithful
   dump with no derived fields.
2. **Run** (`run.mjs`) takes a raw trace (pre-extracted via `--trace`, or
   extracted inline via `--session`), **reconstructs** what the game master saw
   each turn by replaying the events through the real runtime context builders
   (`packages/game-engine/src/ai-context.ts`), runs the always-on mechanical
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

While the judges run, the pipeline prints progress (a `logs:` hint, a
`tail -f …/logs/judge-*.stream.jsonl` hint, and a batched tick on an interval —
`done/total` plus a short per-judge block of token total and recent messages);
`--quiet` suppresses it. The trace judge wrapper runs
`claude --output-format stream-json --verbose`, writes the live event stream to
`logs/<step>.stream.jsonl` (tailable), and recovers the verdict from the
stream's final result event — so the pipeline's `extract_path: "result"`
contract is unchanged. Same machinery as the blueprint pipeline; see
`evaluation/README.md` (§ Live progress).

The process exits non-zero only when the run itself fails (extraction error,
etc.), matching the blueprint pipeline. A check or judge **fail** still exits 0
— the `result.json` summary is the pass/fail signal, so a CI caller should gate
on `summary.mechanical.fail` / `summary.dimensions.fail`, not the exit code.

## Layout

```
evaluation/trace/
├── extract.mjs              # CLI: stored session → raw trace artifact
├── run.mjs                  # CLI: raw trace → reconstruct → checks + judges → envelope
├── lib/
│   ├── normalize.mjs        # pure: rows → canonical raw trace artifact
│   ├── datasource.mjs       # database read (injectable; pure orchestration over 4 methods)
│   ├── reconstruct.mjs      # run-time: fold session state + per-turn context via real builders
│   ├── mechanical.mjs       # always-on deterministic checks (clue_accounting, spoiler_leak)
│   ├── envelope.mjs         # trace-shaped result envelope (reuses combineDimension)
│   └── load.mjs             # dimension registry + definition loaders
├── dimensions/
│   └── registry.json        # which judges make up this pipeline's battery
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

The judge battery itself is shared in the other direction, with the **runtime**
harness: `evaluation/judges/` holds the briefs, the output schemas, the
evaluator preamble, the subject projection, and the `major`-finding verdict
rule, and `evaluation/runtime/` runs the very same judges over a single replayed
interaction.

Trace-specific pieces (a trace has no generate stage; the subject already
exists) live under `evaluation/trace/`. Dimensions follow the same convention as
the blueprint battery: one `<id>.md` prose contract + one `<id>.schema.ts` Zod
schema, picked up by id from `registry.json`. `loadTraceDimensionDefinition`
resolves shared ids from `evaluation/judges/` first, then this pipeline's own
`dimensions/` directory — so a trace-only dimension is still just two files
dropped in here.

## Checks and dimensions

| Check / dimension | Tier       | Asks |
|-------------------|------------|------|
| `clue_accounting` | mechanical | Every revealed clue id is real and in scope; each bare search reveals the next not-yet-revealed location clue that is *unlocked* (its `requires` prerequisites are already revealed), skipping locked clues — the unlocked subsequence, not a strict array prefix — with no repeats. |
| `spoiler_leak`    | mechanical | No pre-accusation narration copies a long *verbatim* run of ground-truth text. Verbatim only (high contiguous-word threshold); paraphrase leakage is a judge's job. |
| `clue_requires_violation` | mechanical (opt-in) | A clue gated by `requires` was not revealed until its prerequisites were already revealed earlier in the trace (off-script grants, listed in the event's `revealed_off_script`, are exempt). **Off by default** — set `enforce_requires: true` in the registry mechanical context to enable. It proves the runtime honors the discovery graph; until the runtime gating is in place a real trace would fail it. |
| `gm_roleplay`     | judge (shared) | Does the game master perform the authored character — persona, alibi, agendas, tells, knowledge boundary — and the required narrator voice? |
| `gm_clue_discipline` | judge (shared) | Were the right clues released, at the right time, and recorded? Catches narration/record mismatches and `requires` gates opened early. |
| `gm_fabrication`  | judge (shared) | Did the game master invent material facts the blueprint does not support? |
| `gm_spoiler`      | judge (shared) | Did pre-accusation narration give away ground truth — culprit, motive, or mechanism — by paraphrase or confirmation? The judge half of `spoiler_leak`. |

## Tests

The pipeline is unit-tested under `tests/api/unit/trace-*.test.ts` (normalize,
reconstruct, mechanical, envelope, run orchestration with a mock judge CLI).
They use injected fixtures and a mock CLI, so they need neither a database nor an
LLM and run in the standard unit gate.

A run costs one model call per judge dimension — four with today's battery,
running in parallel, so wall-clock is the slowest judge rather than their sum.

## Roadmap

- More judges: search adjudication, accusation correctness, tone. (Per-event
  age-appropriateness is already judgeable by converting trace events into
  runtime-harness cases with `evaluation/runtime/cases-from-trace.mjs` and
  running the `flesch` + `age_appropriate` judges there — and those same cases
  now carry the `gm_*` battery with them.)
- Failure → fixture: freeze a flagged turn's reconstructed context as a golden
  fixture and replay it against a different model/prompt to confirm a fix — the
  "switch the model or iterate on the prompt" loop.
- Batch extraction (query a set of sessions) and run-history storage.
