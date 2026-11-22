# The truth set

What judges are scored against: subjects and their known faults, by **kind**,
not judge. Self-play and planted material only, no credential or home path.
Code: `evaluation/lib/truth/`; files off schema or layout fail loading.

Ids are file or folder names: `bases/<base>/blueprint.json` and `brief.json`;
`games/<game>/trace.json`, as `judge game` reads it, and `labels.json`, from the
labelling page; `plants/turns/<variant>.json` and
`plants/blueprints/<plant>.json`, written against `guide.md`, which decides each
kind; `results/<name>.json`, from a suite (`bases.json`, from `store.ts`);
`scores/<name>.json`.

**Kinds.** Game side: `spoiler`, `fabrication`, `clue_handling`,
`out_of_character`, `not_age_fit`. Blueprint side: each dimension's id.

**Labels.** A turn's faults, each a kind, `minor` or `major`, and a note; plus
who, when and the pass. No fault means clean, not unlabelled. Labels append; a
turn's latest is scored. The labelling page makes them
([`evaluation/label/README.md`](../label/README.md)).

## Plants

Variants are rebuilt on demand. Turn plants' edits are `narration`, replacing
the one place `find` occurs, or `patch`, JSON Patch on the event; one plant a
turn. A blueprint plant is JSON Patch on its base, starting with a `test`.

The gate checks each plant applies, changes only what it names, and leaves a
valid subject (a game that reconstructs, a Blueprint V2). `caught_by` lists the
checks newly failing on it: on a game the trace checks at its turn and `flesch`;
on a blueprint the mechanical checks and `<dimension>.analyzer`. A caught plant
needs no judge.

## Units and truth

A unit (a turn and a kind, or a base or blueprint plant) is a fault, clean or
unknown. A labelled turn is a fault of each kind it names, else clean;
unlabelled, unknown. A plant is a fault of its kind, else unknown; a variant's
other turns take the game's labels. A base is clean for every kind: it passed
every check and judge, no more.

A verdict catches a unit with a finding on its turn or blueprint of a kind the
findings table maps to it. A dimension's `fail` is one finding of its kind;
candidates' findings name theirs.

## Results and tables

Results hold verdicts only, no prompt: the judge's version, the
subject's hash, and each finding's turn, kinds, severity, `kind`, `quote`,
`why` and `refers_to`. Once either moves on, a verdict is **stale**: `score`
lists it unscored; a subject without a current one is **unmeasured**. `./dev
eval suite <suite>` (into `results/<suite>.json`) makes only those calls. The
gate regenerates `scores/<name>.json` from its `inputs`. One blueprint sample
measures no variation.

## Made live

On temporary roots, from `evaluation/specs/` briefs and Haiku self-play:

```bash
./dev generate --format v2 evaluation/specs/<brief> --judge
node evaluation/lib/truth/store.ts base <base> <result.json>
./dev eval play --blueprint <file> --persona <detective|kid-7> --narrator-model haiku
./dev eval judge game <session> --database <run>/game.db --no-judges
node evaluation/lib/truth/store.ts game <game> <trace.json> <summary.json>
```
