# The truth set

What the judges are scored against: stored subjects, and what is known to be
wrong in them, named by **kind** of fault, never by judge, so any set of judges
is scored on the same units. Self-play and planted material only; no
credential or home path, gate-tested. Its code is
`evaluation/lib/truth/`; a file outside its schema or this layout fails loading.

Ids are file or folder names. Under it: `bases/<base>/blueprint.json` and `brief.json`, frozen copies;
`games/<game>/trace.json`, self-play as `judge game` reads it, and
`labels.json`, made on the labelling page; `plants/turns/<variant>.json` and
`plants/blueprints/<plant>.json`, written by hand; `guide.md`, how each kind is
decided; `results/<name>.json`, from a suite.

**Kinds.** Game side: `spoiler`, `fabrication`, `clue_handling`,
`out_of_character`, `not_age_fit`. Blueprint side: each blueprint
dimension's id.

**Labels.** A turn's faults, each a kind, `minor` or `major`, and a note; plus
who, when and the pass. No fault means clean, not unlabelled. Labels
are only appended; a turn's latest is scored. `./dev eval label <game>` makes them; pass 1 shows no
judge finding, pass 2 only turns where a judge and the label disagree,
relabelled as pass 2.

## Plants

A variant is rebuilt from its base on demand. A turn plant's
edits are `narration`, which replaces the one place `find` occurs, or `patch`,
JSON Patch on the event, e.g. `/payload/revealed_clue_ids`. A variant has
one plant a turn. A blueprint plant is JSON Patch on its base; a patch starts
with a `test`.

The gate holds each plant to: it applies, changes only what its
edits name, and leaves a valid subject (a game that parses and reconstructs, a
blueprint passing Blueprint V2). `caught_by` lists the checks that newly
fail on it (`[]` for none): on a game the trace checks at its turn and `flesch`;
on a blueprint the mechanical checks and `<dimension>.analyzer`. A caught plant needs no judge.

## Units and truth

A unit is a turn and a kind (game side), or a base or plant (blueprint side),
and is a fault, clean or unknown. A labelled turn is a fault of each kind it
names, else clean; an unlabelled turn is unknown. A planted turn or blueprint
is a fault of its kind, unknown for the others; a variant's other turns take
the game's labels. A base is clean for every kind: it passed every check and
judge, no more.

A verdict catches a unit when a finding points at its turn or blueprint with
a kind the findings table maps to it. A blueprint judge's `fail` is one
finding of its dimension's kind.

**Results** hold verdicts with findings, model, sample, duration and
cost, no prompt, log or workspace. `./dev eval score` scores them,
counting minor findings as reports.
