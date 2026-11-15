# The truth set

What judges are scored against: stored subjects and their known faults, by
**kind**, not judge, so judges are scored on the same units. Self-play and
planted material only; no credential or home path, gate-tested. Code:
`evaluation/lib/truth/`; a file off its schema or layout fails loading.

Ids are file or folder names. Under it: `bases/<base>/blueprint.json` and
`brief.json`, frozen copies; `games/<game>/trace.json`, as `judge game`
reads it, and `labels.json`, from the labelling page;
`plants/turns/<variant>.json` and `plants/blueprints/<plant>.json`, written
against `guide.md`, which decides each kind; `results/<name>.json`, from a suite, or
`store.ts` for the bases' judging, `bases.json`.

**Kinds.** Game side: `spoiler`, `fabrication`, `clue_handling`,
`out_of_character`, `not_age_fit`. Blueprint side: each dimension's id.

**Labels.** A turn's faults, each a kind, `minor` or `major`, and a note; plus
who, when and the pass. No fault means clean, not unlabelled. Labels are only
appended; a turn's latest is scored. `./dev eval label <game>` makes them; pass
1 shows no judge finding, pass 2 only turns where judge and label disagree,
relabelled as pass 2.

## Plants

Variants are rebuilt on demand. Turn plants' edits are `narration`, replacing
the one place `find` occurs, or `patch`, JSON Patch on the event; one plant a
turn. A blueprint plant is JSON Patch on its base, starting with a `test`.

The gate checks each plant applies, changes only what its edits name, and leaves
a valid subject (a game that parses and reconstructs, a blueprint passing
Blueprint V2). `caught_by` lists the checks newly failing on it (`[]` for none):
on a game the trace checks at its turn and `flesch`; on a blueprint the
mechanical checks and `<dimension>.analyzer`. A caught plant needs no judge.

## Units and truth

A unit (a turn and a kind, or a base or blueprint plant) is a fault, clean or
unknown. A labelled turn is a fault of each kind it names, else clean;
unlabelled, unknown. A plant is a fault of its kind, else unknown; a variant's
other turns take the game's labels. A base is clean for every kind: it passed
every check and judge, no more.

A verdict catches a unit with a finding on its turn or blueprint of a kind the
findings table maps to it. A dimension's `fail` is one finding of its kind;
candidates' findings name theirs.

**Results** hold verdicts: findings, model, sample, duration, cost; no prompt,
log or workspace. `./dev eval score` scores them, minor findings as reports.

## Made live

Bases from `evaluation/specs/` briefs; games, Haiku-narrated self-play. On
temporary roots:

```bash
./dev eval generate evaluation/specs/<brief> --judge
node evaluation/lib/truth/store.ts base <base> <result.json>
./dev eval play --blueprint <file> --persona <detective|kid-7> --narrator-model haiku
./dev eval judge game <session> --database <run>/game.db --no-judges
node evaluation/lib/truth/store.ts game <game> <trace.json> <summary.json>
```
