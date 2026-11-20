# Mystery Structure Format

Draft 0.1.0. A JSON representation of a mystery's hidden events, evidence,
testimony and deductions. This is an authoring and evaluation proposal; the
running game still accepts [Blueprint V2](../packages/shared/src/blueprint-schema-v2.ts).

The template is [RUML 1.0.0](https://ruml.org/1.0.0/), particularly its
[flat node map](https://ruml.org/data-model/3-1-architecture-principles),
[operators](https://ruml.org/data-model/3-6-operators) and
[separate results](https://ruml.org/result-format). This proposal borrows those
design principles, with independently written mystery semantics. Its files
have their own format identifier.

## 1. Scope

Represent four distinct things:

- **Reality:** who did what, where, when and why.
- **Knowledge:** what each character knows, believes and claims.
- **Discovery:** where evidence comes from and what unlocks it.
- **Reasoning:** how evidence supports conclusions, clears suspects and
  resolves misleading leads.

The blueprint fixes reality before play. The narrator expresses it, judges
questions and records discoveries; it cannot rewrite it. Session progress,
model settings, art and narrative style belong outside this structural core.
The player-facing contract remains [the game](game.md).

## 2. Document envelope

Files are UTF-8 JSON objects. Required root fields:

| Field | Meaning |
|---|---|
| `$format` | Literal `MYSTERY-STRUCTURE` |
| `$specVersion` | Literal `0.1.0` for this draft |
| `metadata` | `id`, positive integer `revision`, `title`, positive integers `target_age` and `time_budget` |
| `opening` | Public `premise`, `starting_location_id`, `known_fact_ids` |
| `nodes` | Map of stable IDs to typed nodes |
| `solution` | `culprit_id`, chronological `event_ids`, `motive_fact_id`, alternative winning `rule_ids` |
| `red_herrings` | Array of `hypothesis_fact_id`, `lead_clue_ids`, `resolution_rule_id`, `payoff` |
| `eliminations` | Array of `character_id`, `rule_id`, `payoff` |

IDs are nonempty strings, unique across the node map. A node's map key is its
only ID. References use IDs, never names or copied nodes. Preserve IDs through
edits; increment `revision` whenever content changes. Readers reject unsupported
spec versions and unknown fields or node kinds. Empty arrays are explicit;
optional fields are omitted. No executable expressions or external references.

## 3. Node vocabulary

Every node has `kind`; the following fields are also required unless marked
optional. Text and names are nonempty; reference arrays contain no duplicates.

| `kind` | Fields |
|---|---|
| `character` | `name`, `location_id`, `knows_fact_ids`; optional `believes_claim_ids` |
| `location` | `name` |
| `object` | `name` |
| `event` | `text`, `character_ids`, `location_id`, `object_ids`, `after_event_ids`, `caused_by_event_ids` |
| `fact` | Proposition `text`, Boolean `truth`, `about_ids` referencing characters, locations, objects or events |
| `claim` | `character_id` of the speaker, `fact_id`, Boolean `value` asserted by that speaker |
| `clue` | Player-facing `text`, `source`, `establishes_fact_ids`, `reports_claim_ids`; optional `requires`, `origin_event_ids` |
| `rule` | `operator` (`AND` or `OR`), nonempty `children`, nonempty `concludes_fact_ids`, explanatory `rationale` |

Characters' locations are their positions when investigation begins. Events
describe the fixed past. `after_event_ids` records precedence;
`caused_by_event_ids` records causation and also implies precedence. Array order
alone implies neither; unrelated events may overlap. Event text states any
needed timing and object-state changes. Structured clocks and state simulation
are outside this draft.

Facts are propositions with an author's answer: `truth: false` explicitly
denies the proposition. A missing fact has no assigned truth. Knowledge of a
false fact means knowing it is false; beliefs reference claims and may be
mistaken. Neither character knowledge nor a claim automatically becomes
player evidence. Opening facts must be true; their text is public.

A clue that **establishes** a fact supplies its authored truth value. A clue
that **reports** a claim establishes only that the statement was made. If a
speaker's `value` differs from the fact's `truth`, the statement is false;
that alone does not establish whether the speaker is lying or mistaken.

`source` is either `{ "kind": "search", "location_id": "…" }` with an
optional nonempty `spot`, or `{ "kind": "talk", "character_id": "…" }`.
`origin_event_ids` identifies events that produced the evidence.

`requires` has nonempty `clue_ids`, `kind` (`physical`, `social` or `knowledge`)
and `rationale`. All prerequisites must be discovered. Search gates remain
hard. In conversation, clever questioning or bluffing may bypass social or
knowledge gates; physical gates cannot be bypassed. A bypass records the
resulting clue discovery, not fictitious discoveries of its prerequisites.

## 4. Reasoning semantics

A rule's children reference clues or other rules. A clue becomes available
when discovered; a rule becomes supported when all (`AND`) or at least one
(`OR`) of its children is available/supported. Rules conclude the authored
truth values of their facts. `OR` children must each independently justify
every conclusion. Missing evidence means **unresolved**, never false.

Availability is a structural check, not proof that an inference is sound.
`rationale` explains why the premises justify the conclusion. Judges must still
check necessity, sufficiency, witness credibility and alternative explanations.
A discovered false statement cannot silently count as proof of its content.

Solution rules must establish culprit, incident and motive; alternative rules
are alternative sufficient routes. A red herring's lead clues suggest its
false hypothesis; its resolution rule establishes that hypothesis's falsity.
Suspicion is not an inference rule proving something false. An elimination
rule establishes a false proposition that its named character committed the
incident. Every non-culprit suspect needs an elimination route.

Supporting a solution rule does not automatically win the game. The player
must make an accusation, and a correct reconstruction can also succeed without
following an authored route. See [accusations](game.md#the-accusation).

## 5. Worked example

This compact case illustrates the format, rather than production difficulty
or all the prose required by Blueprint V2.

```json
{
  "$format": "MYSTERY-STRUCTURE",
  "$specVersion": "0.1.0",
  "metadata": {
    "id": "missing-star-medal", "revision": 1,
    "title": "The Missing Star Medal", "target_age": 9, "time_budget": 10
  },
  "opening": {
    "premise": "The star medal has vanished from the hall. Can you find out why?",
    "starting_location_id": "hall", "known_fact_ids": []
  },
  "nodes": {
    "hall": { "kind": "location", "name": "Exhibition Hall" },
    "store": { "kind": "location", "name": "Store Room" },
    "medal": { "kind": "object", "name": "Star Medal" },
    "ada": {
      "kind": "character", "name": "Ada", "location_id": "store",
      "knows_fact_ids": ["access", "stored", "motive", "ada_moved", "ada_alibi"]
    },
    "ben": {
      "kind": "character", "name": "Ben", "location_id": "hall",
      "knows_fact_ids": ["ben_moved", "ben_ink"]
    },
    "leak": {
      "kind": "event", "text": "Rain leaked onto the medal display.",
      "character_ids": [], "location_id": "hall", "object_ids": ["medal"],
      "after_event_ids": [], "caused_by_event_ids": []
    },
    "move": {
      "kind": "event", "text": "Ada put the medal in the store cupboard to keep it dry.",
      "character_ids": ["ada"], "location_id": "store", "object_ids": ["medal"],
      "after_event_ids": [], "caused_by_event_ids": ["leak"]
    },
    "access": {
      "kind": "fact", "text": "Only Ada could open the cupboard during the incident.",
      "truth": true, "about_ids": ["ada", "store", "move"]
    },
    "stored": {
      "kind": "fact", "text": "The missing medal was placed in the locked cupboard.",
      "truth": true, "about_ids": ["medal", "store", "move"]
    },
    "motive": {
      "kind": "fact", "text": "The medal was moved to protect it from the roof leak.",
      "truth": true, "about_ids": ["ada", "medal", "leak", "move"]
    },
    "ada_moved": {
      "kind": "fact", "text": "Ada moved the medal into the cupboard.",
      "truth": true, "about_ids": ["ada", "move"]
    },
    "ben_moved": {
      "kind": "fact", "text": "Ben moved the medal into the cupboard.",
      "truth": false, "about_ids": ["ben", "move"]
    },
    "ben_ink": {
      "kind": "fact", "text": "Ben's ink stain was left when the medal vanished.",
      "truth": false, "about_ids": ["ben", "hall", "move"]
    },
    "ada_alibi": {
      "kind": "fact", "text": "Ada stayed in the hall throughout the incident.",
      "truth": false, "about_ids": ["ada", "hall", "move"]
    },
    "alibi": { "kind": "claim", "character_id": "ada", "fact_id": "ada_alibi", "value": true },
    "key": {
      "kind": "clue", "text": "The key record shows Ada held the only cupboard key until after the medal vanished. The key now hangs here.",
      "source": { "kind": "search", "location_id": "hall", "spot": "key hook" },
      "establishes_fact_ids": ["access"], "reports_claim_ids": []
    },
    "cupboard": {
      "kind": "clue", "text": "You unlock the cupboard and find the missing medal.",
      "source": { "kind": "search", "location_id": "store", "spot": "cupboard" },
      "establishes_fact_ids": ["stored"], "reports_claim_ids": [],
      "origin_event_ids": ["move"],
      "requires": { "clue_ids": ["key"], "kind": "physical", "rationale": "The key is needed to open the locked cupboard." }
    },
    "note": {
      "kind": "clue", "text": "A rain-spattered note reads: 'Medal moved to the dry cupboard to save it from the leaking roof.'",
      "source": { "kind": "search", "location_id": "hall", "spot": "note tray" },
      "establishes_fact_ids": ["motive"], "reports_claim_ids": [], "origin_event_ids": ["move"]
    },
    "ink": {
      "kind": "clue", "text": "An ink stain by the empty display matches Ben's pen.",
      "source": { "kind": "search", "location_id": "hall" },
      "establishes_fact_ids": [], "reports_claim_ids": []
    },
    "photo": {
      "kind": "clue", "text": "Ben shows yesterday's photograph: the same stain is beside the medal.",
      "source": { "kind": "talk", "character_id": "ben" },
      "establishes_fact_ids": [], "reports_claim_ids": []
    },
    "denial": {
      "kind": "clue", "text": "Ada says, 'I stayed in the hall the whole time.'",
      "source": { "kind": "talk", "character_id": "ada" },
      "establishes_fact_ids": [], "reports_claim_ids": ["alibi"]
    },
    "identify": {
      "kind": "rule", "operator": "AND", "children": ["key", "cupboard"],
      "concludes_fact_ids": ["ada_moved", "ben_moved"],
      "rationale": "The medal was placed in the locked cupboard while only Ada had access, identifying Ada and ruling out Ben as its mover."
    },
    "solve": {
      "kind": "rule", "operator": "AND", "children": ["identify", "note"],
      "concludes_fact_ids": ["ada_moved", "stored", "motive"],
      "rationale": "The access evidence identifies Ada; the note explains why the medal was moved."
    },
    "clear_ink": {
      "kind": "rule", "operator": "AND", "children": ["ink", "photo"],
      "concludes_fact_ids": ["ben_ink"],
      "rationale": "The photograph dates the stain before the disappearance."
    }
  },
  "solution": {
    "culprit_id": "ada", "event_ids": ["leak", "move"],
    "motive_fact_id": "motive", "rule_ids": ["solve"]
  },
  "red_herrings": [{
    "hypothesis_fact_id": "ben_ink", "lead_clue_ids": ["ink"],
    "resolution_rule_id": "clear_ink", "payoff": "The ink stain does not date Ben's presence to the disappearance."
  }],
  "eliminations": [{
    "character_id": "ben", "rule_id": "identify",
    "payoff": "Ben could not have put the medal inside the locked cupboard."
  }]
}
```

Discovering `denial` reveals Ada's statement, without making her alibi true or
exposing its falsity. Discovering `key` unlocks `cupboard`; those two support
`identify`. Adding `note` supports `solve`. Alternatively, `ink` and `photo`
resolve a misleading lead without establishing the solution.

## 6. Validation and disclosure

A future validator must reject malformed fields and wrong-kind or dangling
references. It must also enforce:

- Acyclic event precedence, clue prerequisites and rule dependencies;
  causal predecessors occur earlier in `solution.event_ids`.
- Exactly one named culprit; at least one solution rule; the motive fact is
  true. Every red-herring hypothesis is false, with a resolution rule that
  concludes it. Each elimination excludes a different non-culprit suspect.
- Every solution clue is reachable from ungated clues. At least one solution
  route needs no discretionary conversational bypass and fits the turn budget.
  Rules contain no duplicated inputs or self references.

Content review must check truth/claim consistency, causal plausibility,
necessary evidence, unique culprit, age suitability and useful payoffs. A
matching Boolean value or a large graph cannot replace those judgments.

The full graph is server-side authoring data. Public responses contain only
approved opening text, public entity descriptions and discovered clue text.
They must exclude fact truth values, private knowledge, culprit identity,
rules and path membership. Character narration receives only that character's
permitted knowledge and discoveries relevant to the interaction. Accusation
evaluation can receive the complete structure. Runtime projections remain
governed by [narration inputs](blueprint-generation-flows.md#narration-at-play).

Progress and evaluation results stay separate, pinned to mystery `id` and
`revision`. Discovered clue IDs and recorded off-script reveals are replay
inputs; supported rules and known fact values are derived outputs. Model
decisions and bypass reasons must be recorded so replay does not rerun them.
Reaching a rule does not itself disclose its conclusion to the player.

## 7. Relationship to Blueprint V2

| V2 concept | Structural representation |
|---|---|
| Locations, characters and nested clues | Nodes and clue `source` references |
| `ground_truth.timeline`, `actual_actions` | Shared event nodes |
| `what_happened`, `why_it_happened`, `is_culprit` | Events, facts and `solution` |
| `stated_alibi`, character knowledge | Claims and explicit knowledge references |
| `requires` | Clue discovery prerequisites with explicit gate kind |
| Three reasoning-path collections | Rules, red herrings and eliminations |

V2 prose does not determine event boundaries, knowledge, gate kinds or deduction
steps mechanically. Conversion therefore needs author review; it cannot be
lossless by renaming fields. Adoption would also update generator prompts,
narrator projections, mechanical checks, judges, fixtures and truth sets,
while retaining replay and self-play. This proposal installs no converter,
validator or replacement runtime schema.
