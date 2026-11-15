# The truth set

What the judges are scored against: stored subjects, and what is known to be
wrong in them, named by **kind** of fault, never by judge, so any set of judges
is scored on the same units. It holds self-play and planted material only, no
credential or home path, which a gate test enforces. Its code is
`evaluation/lib/truth/`; a file outside its schema or this layout fails loading.

Ids are file or folder names. Under it: `bases/<base>/blueprint.json` and `brief.json`, frozen copies;
`games/<game>/trace.json`, self-play as `judge game` reads it, and
`labels.json`, made on the labelling page; `plants/turns/<variant>.json` and
`plants/blueprints/<plant>.json`, written by hand; `guide.md`, how each kind is
decided; `results/<name>.json`, from a suite.

**Kinds.** Game side: `spoiler`, `fabrication`, `clue_handling`,
`out_of_character`, `not_age_fit`. Blueprint side: one per blueprint
dimension, spelled as its id.

**Labels.** A turn's faults, each a kind, `minor` or `major`, and a note; plus
who, when and the pass (1 or 2). No fault means clean, not unlabelled. Labels
are only appended; a turn's latest is scored.

## Plants

A variant is rebuilt from its base on demand, never stored. A turn plant's
edits are `narration`, which replaces the one place `find` occurs, or `patch`,
JSON Patch on the event, such as `/payload/revealed_clue_ids`. A variant has
one plant a turn. A blueprint plant is JSON Patch on its base. A patch starts
with a `test`.

The gate, with no model, holds each plant to: it applies, changes only what its
edits name, and leaves a valid subject (a game that parses and reconstructs, a
blueprint passing Blueprint V2). Its `caught_by` lists the checks that newly
fail on it, `[]` for none: on a game the trace checks at its turn and `flesch`;
on a blueprint the mechanical checks and `<dimension>.analyzer`. A mismatch
prints what they report. A caught plant needs no judge.

## Units and truth

A unit is a turn and a kind (game side), or a base or plant (blueprint side),
and is a fault, clean or unknown. A labelled turn is a fault of each kind it
names, else clean; an unlabelled turn is unknown. A planted turn is a fault of
its kind, unknown for the others; a variant's other turns take the game's
labels. A base is clean for every kind: it passed every check and judge, no
more. A plant is a fault of its kind, unknown for the others.

A verdict catches a unit when a finding points at its turn, or blueprint, with
a kind the findings table maps to the unit's. A blueprint judge's `fail` is one
finding of its dimension's kind.

**Results** hold verdicts with kinded findings, model, sample, duration and
cost, no prompt, log or workspace.
