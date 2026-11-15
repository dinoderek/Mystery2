# The truth set

What the judges are scored against: stored subjects and what is known to be
wrong in them, named by **kind** of fault, never by judge, so any set of judges
is scored on the same units. Self-play and planted material only, and no
credential or home path, which a gate test enforces.

Its code is `evaluation/lib/truth/`; a file outside this layout fails
loading. Ids are file and folder names.

| Part | Where | Made by |
|---|---|---|
| Base blueprints | `bases/<base>/blueprint.json`, `brief.json` | A frozen copy, passing every check and judge |
| Stored games | `games/<game>/trace.json` | Self-play, as `judge game` reads |
| Labels | `games/<game>/labels.json` | Hand, on the labelling page |
| Planted turn faults | `plants/turns/<variant>.json` | Hand |
| Planted blueprint faults | `plants/blueprints/<plant>.json` | Hand |
| Guide | `guide.md` | Hand |
| Results | `results/<name>.json` | A suite |

**Kinds.** Game side: `spoiler`, `fabrication`, `clue_handling`,
`out_of_character`, `not_age_fit`. Blueprint side: each blueprint dimension's
id.

**Labels.** A turn's faults, each a kind, `minor` or `major` and a note, plus
who, when and the pass. No fault is clean, which differs from no label. Labels
are appended; the latest is scored. `./dev eval label <game>` makes them. Pass
1 shows each turn and no judge finding. Pass 2 needs stored results and shows
only turns where a judge and the label disagree (a catch on a turn labelled
clean for the kind, or a labelled fault no sample caught), and records relabels
as pass 2.

**Plants** are applied by code. A turn plant edits one turn's narration or
record to make one fault of its kind; a blueprint plant patches a base for the
judge it names, in JSON Patch starting with a `test`.

## Units and truth

A game-side unit is a turn and a kind; a blueprint-side one, a base or a
plant. Each is a fault, clean or unknown:

- A turn takes its latest label: a fault of each kind it names, else clean; no
  label, unknown. A planted turn is a fault of its kind, unknown for the
  others; a variant's other turns take the stored game's labels.
- A base is clean for every kind, only in that it passed every check and judge;
  a plant is a fault of its kind, unknown for the others.

A verdict catches a unit when a finding points at its turn or blueprint with a
kind the findings table maps to the unit's; a blueprint judge's `fail` is one
finding of its kind.

**Results** keep verdicts with kinded findings, model, sample, duration and
reported cost (null when none), never a prompt, log or workspace.
