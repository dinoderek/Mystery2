# The truth set

What the judges are scored against: stored subjects, and what is known to be
wrong in them, named by **kind** of fault, never by judge, so any set of judges
is scored on the same units. It holds self-play and planted material only, and
no credential or home path, which a gate test enforces.

Its code is `evaluation/lib/truth/`. A file failing its schema, or outside
this layout, fails loading with its path and field. Ids are file and folder
names.

| Part | Where | Made by |
|---|---|---|
| Base blueprints | `bases/<base>/blueprint.json`, `brief.json` | A frozen copy, passing every check and judge |
| Stored games | `games/<game>/trace.json` | Self-play, as the trace `judge game` reads |
| Labels | `games/<game>/labels.json` | Hand, on the labelling page |
| Planted turn faults | `plants/turns/<variant>.json` | Hand, against a stored game |
| Planted blueprint faults | `plants/blueprints/<plant>.json` | Hand, against a base |
| Guide | `guide.md` | Hand: how each kind is decided |
| Results | `results/<name>.json` | A suite |

**Kinds.** Game side: `spoiler`, `fabrication`, `clue_handling`,
`out_of_character`, `not_age_fit`. Blueprint side: one per blueprint
dimension, spelled as its id.

**Labels.** A turn's faults, each a kind, `minor` or `major`, and a note;
plus who, when and the pass (1 or 2). No fault means clean, which differs from
no label. Labels are only appended; a turn's latest is scored.

**Plants** are applied by code, never by hand. A turn plant edits one turn's narration, or what it recorded, to make one fault
of its kind; a variant carries one or more. A blueprint plant patches a base
for the judge it names. Patches are JSON Patch, starting with a `test`.

## Units and truth

A game-side unit is a turn and a kind; a blueprint-side unit, a base or a
plant. Each is a fault, clean or unknown:

- A labelled turn is a fault of each kind it names, else clean; unlabelled,
  unknown.
- A planted turn is a fault of its kind, unknown for the others. A variant's
  other turns take the stored game's labels.
- A base is clean for every kind. That is the only sense of clean here: it
  passed every check and judge, no more.
- A plant is a fault of its kind, unknown for the others.

A verdict catches a unit when a finding points at its turn, or blueprint, with
a kind the findings table maps to the unit's. A blueprint judge's `fail` is one
finding of its dimension's kind.

**Results** keep verdicts with their kinded findings, model, sample, duration
and reported cost (null when none), and no prompt, log or workspace.
