# Character Conversation Agendas

**Status:** Design
**Last updated:** 2026-03-27

## Problem

Characters currently behave as cooperative witnesses. They have clues they try
to share and flavor knowledge they share freely. There is no friction, no
negotiation, and no drama. The player asks a question, the character answers,
and the conversation is over.

This makes character interactions feel flat and mechanical. The interesting part
of a mystery — reading people, catching lies, pressuring witnesses, building
trust — is missing.

## Goal

Make character conversations into a **puzzle mechanic** where players must read
between the lines, approach characters strategically, and sometimes return
after finding new evidence or trying a different tactic.

## Design Overview

Add an `agendas` array to each character in the blueprint. An agenda is a
structured behavioral directive that tells the narrator AI *how* a character
filters their responses. Agendas create friction — they gate, redirect, or
distort information flow based on the character's goals.

The key design principle is that agendas are **behavioral guidance, not hard
gates**. The narrator AI interprets them and produces natural roleplay. A
skilled or persistent player can sometimes break through even without the
"designed" unlock condition.

---

## Agenda Taxonomy

### 1. Self-Protection

The character actively avoids incriminating themselves.

| Strategy | Description |
|---|---|
| `maintain_false_alibi` | Commits to a specific false story. Will contradict themselves under sustained pressure or when confronted with specific evidence. |
| `deny_motive` | Downplays or denies their reason to be suspicious. Redirects to other topics. |
| `minimize_presence` | Understates how much they saw, heard, or were involved. "I wasn't really paying attention." |

### 2. Protect Another

The character covers for someone else.

| Strategy | Description |
|---|---|
| `deflect_questions` | Avoids volunteering info that implicates a specific other character. May actively redirect. |
| `provide_false_cover` | Actively lies about another character's whereabouts or actions. |

The blueprint must specify **who** they protect (`target_character_id`) and
**why** (`reason`). The reason matters because it determines what breaks
through — family loyalty yields to different pressure than fear of retaliation.

### 3. Implicate Another (offensive deflection)

The character actively steers suspicion toward someone else.

| Strategy | Description |
|---|---|
| `plant_doubt` | Casually brings up another character's motive, opportunity, or suspicious behavior. Should feel organic, not forced. |
| `exaggerate_truth` | Takes real facts about another character and presents them in the worst possible light. Uses the investigation to settle a grudge. |

### 4. Conditional Information Release

The character has information but will only share it under specific conditions.
**This is where the core gameplay innovation lives.**

#### Condition Types

| Condition | Trigger | Description |
|---|---|---|
| `confronted_with_evidence` | Player **uses** specific clues in conversation | The player must not only possess a clue but actively reference it. "I found blue fur in the bakery — care to explain?" The narrator matches the player's conversational text against the clue content, not just the clue ID in the known set. |
| `clever_questioning` | Player asks from the right angle or follows a promising line of reasoning | The character responds to *how* the question is framed, not just what evidence the player has. Asking about "that evening" gets nothing, but asking "who else was in the garden after dark" triggers a reaction. |
| `bluff` | Player claims knowledge or evidence they may or may not possess | The character can't tell if the player is bluffing. If the player confidently asserts "We already know you were in the library," the character may crack even if the player has no proof. **Consequence of failure:** the character trusts the investigator less for the rest of the conversation. The narrator should remember the failed bluff in subsequent turns and make the character more guarded. |
| `trust_established` | Player demonstrates sympathy, patience, or offers assurance of protection | Requires empathetic, non-threatening conversation. May include the player offering to keep someone out of trouble ("I'll leave your sister out of this"). The blueprint should hint at *how* trust can be established — what the character cares about, what reassurance they need. |
| `pressure` | Player applies sustained direct confrontation | Stonewalls by default but caves under persistent, direct questioning. The blunt-force approach. |

**Note:** `trust_established` covers both empathetic rapport-building and
explicit protection promises. These are two sides of the same coin — the
character needs to feel safe before they talk.

#### How Conditions Are Evaluated

Conditions fall into two categories based on how the narrator AI evaluates
them:

**Evidence-based conditions** (`confronted_with_evidence`): The narrator
receives both `player_known_clue_ids` (for tracking) and the full
`player_known_clues` array with clue text and IDs. The narrator matches the
player's conversational input against the clue content — the player must
**actively use** the clue in what they say, not merely possess it. This means
the AI compares what the player writes against the text of known clues and the
yields-to clues specified in the agenda.

**Narrative conditions** (`clever_questioning`, `bluff`, `trust_established`,
`pressure`): The narrator AI judges whether the player's conversational
behavior meets the condition. This is inherently fuzzy — the AI interprets the
player's approach, tone, and reasoning.

The blueprint provides guidance for narrative conditions via a
`details` field that tells the narrator what to look for. For example:

```
condition: "clever_questioning"
details: "Will open up if the player asks specifically about what happened
          AFTER the party ended, not during it. Questions about the timeline
          after midnight will trigger a visible reaction."
```

For `bluff` conditions:

```
condition: "bluff"
details: "If the player claims to know about the argument in the garden,
          this character will panic and reveal what they overheard. A failed
          bluff will make the character more guarded and dismissive."
```

### 5. Cross-Character Knowledge

Characters may know things about other characters, clue locations, or events
they witnessed. These are modeled as **clues with specific sub-types** rather
than a separate system.

#### New Clue Roles

| Role | Description |
|---|---|
| `alibi_knowledge` | Character can confirm or deny another character's stated alibi. References `about_character_id`. |
| `location_hint` | Character knows where a clue can be found. "You should take a closer look at the garden shed." References `hint_location_id` and optionally `hint_clue_id`. |
| `witness_testimony` | Character witnessed another character doing something. References `about_character_id` and describes what they saw. |
| `motive_knowledge` | Character is aware of another character's secret motive or reason to be suspicious. References `about_character_id`. |

These knowledge clues can be **gated behind agendas** like any other clue. A
character might know the culprit's alibi is false but refuse to say so because
of a `protect_other` agenda — until the player presents evidence that makes
silence untenable.

#### Schema for Cross-Character Clues

Cross-character knowledge clues use the existing `BlueprintV2CharacterClueSchema`
with two optional reference fields:

```
{
  id: "clue-alibi-witness",
  text: "I saw Thomas leave the kitchen at 9:15, not 10pm like he claims.",
  role: "alibi_knowledge",
  about_character_id: "thomas",        // optional: which character this is about
  hint_location_id: "garden-shed"      // optional: which location this points to
}
```

These references are metadata for the narrator AI and the evaluator. They do
not change how the clue is revealed — that is still governed by the character's
agendas and the narrator prompt.

---

## Schema Changes

### Character Agenda Schema

```typescript
const BlueprintV2AgendaConditionSchema = z.enum([
  "confronted_with_evidence",
  "clever_questioning",
  "bluff",
  "trust_established",
  "pressure",
]);

const BlueprintV2AgendaSchema = z.object({
  type: z.enum([
    "self_protect",
    "protect_other",
    "implicate_other",
    "conditional_reveal",
  ]),
  strategy: z.string().trim().min(1).describe(
    "Specific behavioral strategy from the taxonomy."
  ),
  priority: z.enum(["high", "medium", "low"]).describe(
    "Processing order. High-priority agendas take precedence."
  ),
  details: z.string().trim().min(1).describe(
    "Narrative guidance for the narrator AI. Describes the specific behavior, "
    + "what triggers it, and how it manifests in conversation."
  ),
  target_character_id: z.string().optional().describe(
    "For protect_other and implicate_other: which character this agenda is about."
  ),
  gated_clue_id: z.string().optional().describe(
    "For conditional_reveal: which clue is gated behind this agenda."
  ),
  condition: BlueprintV2AgendaConditionSchema.optional().describe(
    "For conditional_reveal: what unlocks the gated clue."
  ),
  yields_to_clue_ids: z.array(z.string()).optional().describe(
    "For confronted_with_evidence: specific clue IDs whose content the player "
    + "must reference in conversation to break through."
  ),
});
```

### Character Clue Schema Extension

```typescript
const BlueprintV2CharacterClueSchema = z.object({
  id: BlueprintV2IdSchema,
  text: z.string().trim().min(1),
  role: BlueprintV2ClueRoleSchema,  // extended with new roles
  about_character_id: z.string().optional().describe(
    "For alibi_knowledge, witness_testimony, motive_knowledge: "
    + "which character this clue is about."
  ),
  hint_location_id: z.string().optional().describe(
    "For location_hint: which location this clue points to."
  ),
});
```

### Clue Role Enum Extension

Add to `BlueprintV2ClueRoleSchema`:

```
"alibi_knowledge"
"location_hint"
"witness_testimony"
"motive_knowledge"
```

### Character Schema Addition

Add to `BlueprintV2CharacterSchema`:

```typescript
agendas: z.array(BlueprintV2AgendaSchema).default([]).describe(
  "Behavioral directives that shape how this character responds in conversation."
),
```

The field is optional with a default empty array, preserving backward
compatibility with existing blueprints.

---

## Narrator Prompt Changes

### New Context: Player Known Clues

Add to `TalkCharacterPrivateContext`:

```typescript
player_known_clues: Array<{ id: string; text: string; role: string }>;
```

This is the full set of clues the player has discovered across all location
searches and character conversations so far — with **both IDs and text**. The
narrator needs the clue text to match against what the player writes in
conversation. A player saying "I found blue fur near the oven" needs to be
matched against a clue whose text mentions blue fur, not just checked against
an opaque ID.

The `player_known_clue_ids` flat set is still useful for quick checks and
tracking, but the narrator prompt operates on the text-rich version.

**Implementation:** Reconstruct from game events at talk-context build time.
Location clues come from `search` event payloads (`revealed_clue_ids`) cross-
referenced against the blueprint's location clue arrays for text. Character
clues come from `ask` event payloads (see "Clue Reveal Tracking" below).

### Updated `talk-conversation.md` Prompt

Replace the current thin prompt with agenda-aware behavioral rules:

```markdown
You are roleplaying `{{character_name}}` in a children's mystery game.
The investigator is `{{target_age}}` years old. Use language, vocabulary,
and sentence complexity that a `{{target_age}}`-year-old can comfortably
read and understand.

Task:
- Reply to the investigator's latest question: `{{player_input}}`.
- Maintain continuity with previous conversation turns.
- Stay consistent with known world facts and the character's perspective.
- Never reveal full solution ground truth.
- Keep response concise (2-5 sentences).

## Character Behavior

Process the character's agendas in priority order (high > medium > low).
Agendas shape HOW you respond, not WHETHER you respond.

### Self-Protection Agendas
When active, avoid incriminating yourself. Deflect, reinforce your stated
alibi, change the subject, or become evasive. If the player references
evidence that matches a `yields_to` clue (compare their words against the
clue text in `player_known_clues`), begin to crack — show discomfort,
offer reluctant partial truths.

### Protect-Other Agendas
When active, avoid volunteering information that implicates the target
character. Redirect conversation. If yields_to conditions are met,
the protection weakens — show conflict between loyalty and honesty.

### Implicate-Other Agendas
Naturally steer conversation toward the target character. This should
feel organic: "Have you talked to [name]? I heard they..." Do not
make it feel like a scripted accusation.

### Conditional Reveal Agendas
The gated clue CANNOT be revealed until the condition is met.

For `confronted_with_evidence`: the player must actively USE the
relevant clue in conversation — not just possess it. Compare what
the player writes against the clue texts in `player_known_clues`
and the `yields_to_clue_ids` specified in the agenda. If the player
references the substance of the clue (exact wording not required,
semantic match is fine), the condition is met. If not, hint that you
know something but deflect.

For `clever_questioning`: judge whether the player's question matches
the approach described in `details`. If close but not quite, show a
visible reaction (hesitation, nervous glance) to signal they are on
the right track.

For `bluff`: judge whether the player is asserting knowledge they may
or may not have. If the bluff is convincing AND plausible given what
this character knows, reveal the gated clue. If the bluff is clearly
false or implausible, the character sees through it — become more
guarded and trust the investigator less for the remainder of this
conversation. Remember any failed bluffs from earlier turns and
factor them into your willingness to share.

For `trust_established`: judge whether the player has been empathetic,
patient, and non-threatening. This may include offering protection
for someone the character cares about. Use the `details` field for
guidance on what this character specifically needs to hear.

For `pressure`: sustained, direct confrontation across multiple turns.
Do not yield on the first attempt.

### Characters With No Agendas
Behave as cooperative witnesses. Share clues when relevant to the
question. Share flavor knowledge freely.

### Behavioral Tells
IMPORTANT: When agendas are active, show behavioral cues. Characters
should "leak" tells:
- Hesitation before answering sensitive topics
- Nervous glances or subject changes
- Overly emphatic denials
- Contradicting themselves under pressure
- Visible discomfort when a topic hits close to an agenda

The player should sense something is off even before they have the
evidence or approach to break through.

### Cross-Character Knowledge
When a character has clues with `about_character_id` or
`hint_location_id`, use that context to make responses richer. A
character who knows about another's false alibi might show discomfort
when that person is mentioned, even if they won't reveal the clue yet.

### Fallback
If the player has asked about a gated topic 3+ times across separate
conversation visits with different approaches, you may begin to crack
even without the designed unlock condition. Mysteries must remain
solvable.

### Language
Remember: the reader is `{{target_age}}` years old. Every word of
your response must be readable at that level. Shorter sentences for
younger readers. Simpler vocabulary. But still in character.

Return JSON:
{
  "narration": "...",
  "revealed_clue_ids": []
}
```

### Updated `talk-start.md` Prompt

Add agenda awareness and age-appropriate language to the conversation opener:

```markdown
You are the in-character narrator for a children's mystery game.
The investigator is `{{target_age}}` years old. Use language, vocabulary,
and sentence complexity appropriate for that reading level.

Task:
- Start a new conversation with `{{character_name}}` in `{{location_name}}`.
- Keep response concise (2-4 sentences).
- Do not reveal hidden solution facts.
- If the character has agendas, their opening attitude should reflect them.
  A character with a self-protection agenda might be wary or overly casual.
  A character wanting to implicate someone might be eager to talk.
  A nervous character protecting someone might seem distracted.

Return JSON:
{
  "narration": "..."
}
```

---

## Clue Reveal Tracking

### Current State

Location clue reveals are tracked via `search` event payloads
(`revealed_clue_ids`). Character clue reveals are **not tracked** — the
narrator AI decides in real-time whether to share a clue, but no event records
which clues were shared.

### Required Change

Track character clue reveals in `ask` event payloads via AI-reported reveals.

Extend the `talk_conversation` response contract to include an optional
`revealed_clue_ids` array:

```json
{
  "narration": "...",
  "revealed_clue_ids": ["clue-id-1"]
}
```

The narrator AI reports which clues it revealed in this response. The
`game-ask` endpoint persists these in the event payload. The full
`player_known_clues` set is reconstructed from both `search` and `ask` events,
cross-referencing IDs against blueprint clue arrays to get the full text.

Validate reported IDs server-side against the character's actual clue list to
catch hallucinated IDs.

---

## Blueprint Generation Changes

### Story Brief Configuration Knobs

The story brief already has fields like `brief`, `targetAge`, `timeBudget`,
`titleHint`, `artStyle`, and `mustInclude`. Add new optional
fields to control mystery complexity:

```typescript
interface StoryBrief {
  // ... existing fields ...

  /** Number of culprits. Default: 1. */
  culprits?: number;

  /** Number of suspects (characters with apparent motive and opportunity,
      in addition to the culprit). These are red-herring suspects. */
  suspects?: number;

  /** Number of witness characters (people who know something interesting
      but are not suspects). */
  witnesses?: number;

  /** Number of locations. */
  locations?: number;

  /** Number of red herring plot threads to weave in. */
  redHerringTrails?: number;

  /** Whether suspects should have cover stories or false alibis that
      need to be investigated. Increases complexity. */
  coverUps?: boolean;

  /** Complexity of suspect elimination — how much work it takes to
      rule out innocent suspects.
      "simple": one clue rules them out.
      "moderate": requires cross-referencing 2+ clues.
      "complex": requires breaking through agendas or following
                  multi-step reasoning. */
  eliminationComplexity?: "simple" | "moderate" | "complex";
}
```

The generator prompt uses these knobs to scale the mystery. When a knob is
absent, the generator uses its own judgment based on `targetAge` and
`timeBudget`.

### Generator Prompt Addition

Add new steps to the internal workflow (after step 5 "Design reasoning
structure"):

```markdown
6. Author character agendas:
   - The culprit MUST have at least one self-protection agenda
     (maintain_false_alibi, deny_motive, or minimize_presence) with
     priority "high".
   - Non-culprit characters SHOULD have agendas that create
     conversational friction where it serves the story:
     - protect_other (covering for someone — with a stated reason)
     - implicate_other (grudge, rivalry, or genuine suspicion)
     - conditional_reveal (gating a clue behind a condition)
   - Some characters MUST remain agenda-free (cooperative witnesses) to
     ensure the player isn't stonewalled everywhere.
   - Scale agenda count and complexity to the story brief's cast size
     and complexity settings. Smaller mysteries need fewer agendas.
   - For conditional_reveal agendas with condition "confronted_with_evidence":
     every yields_to_clue_id must reference an obtainable clue from
     a location or a different character.
   - For conditional_reveal agendas with narrative conditions
     (clever_questioning, bluff, trust_established, pressure): the
     details field must give the narrator AI enough guidance to evaluate
     the condition consistently.
   - For trust_established conditions: include a hint about what the
     character cares about and what reassurance would help them open up.
   - Agendas must not create circular dependencies (A's reveal requires
     B's reveal which requires A's reveal).
   - At least one solution_path must be completable even if no
     narrative-condition reveals are unlocked. Evidence-gated reveals
     (confronted_with_evidence) are acceptable on the critical path
     because their unlock is deterministic, but clever_questioning,
     bluff, trust_established, and pressure conditions must not be
     the only way to reach the solution.

7. Author cross-character knowledge clues:
   - Where appropriate, give characters alibi_knowledge, witness_testimony,
     motive_knowledge, or location_hint clues.
   - These clues create a web of interdependence between characters —
     talking to one character may unlock understanding about another.
   - Cross-character knowledge clues may be gated behind agendas.
   - Reference the target character or location using about_character_id
     and hint_location_id.
```

Add to the fair-play requirements:

```markdown
- Solvability with agendas: At least one solution_path must be
  completable without relying on narrative-condition gated clues
  (clever_questioning, bluff, trust_established, pressure). Clues
  gated behind confronted_with_evidence are acceptable on the critical
  path since the unlock is deterministic. Narrative-condition gated
  clues provide alternative paths and richer gameplay but must not be
  the ONLY way to solve the mystery.
- No circular dependencies: If clue A is gated behind evidence of clue B,
  clue B must not be gated behind evidence of clue A (directly or
  transitively).
```

### Challenge Calibration Update

Remove hardcoded numbers. The generator should scale based on story brief
configuration:

```markdown
### Agenda distribution
Scale agendas to the cast size and brief configuration:
- Culprit: always 1+ self-protection agenda.
- Suspect characters: likely have agendas (self-protect, implicate_other,
  or conditional_reveal) — they have something to hide or an axe to grind.
- Witness characters: may have agendas if there's a story reason (e.g.,
  protecting someone) but many witnesses should be cooperative.
- At least one character should be agenda-free (cooperative baseline).
- Include at least one conditional_reveal with a narrative condition
  (not just confronted_with_evidence) to reward clever play.
- When the brief specifies coverUps: true, suspects should have
  maintain_false_alibi or provide_false_cover agendas.
- When eliminationComplexity is "complex", suspect elimination may
  require breaking through agendas.
```

---

## Evaluator Changes

### New Evaluation Dimension

Add `agenda_consistency` as the 10th evaluation dimension:

```markdown
10. agenda_consistency
Decide whether the character agendas are internally consistent and do not
break solvability.

Check:
- Every yields_to_clue_id references an existing, obtainable clue
- No circular dependencies between conditional_reveal agendas
  (direct or transitive)
- At least one solution_path is completable without relying on
  narrative-condition gated clues (clever_questioning, bluff,
  trust_established, pressure)
- The culprit has at least one self-protection agenda
- At least one character has no agendas
- Every conditional_reveal references a valid gated_clue_id that exists
  in that character's clues array
- Every target_character_id references an existing character
- Narrative condition details are specific enough for consistent
  AI evaluation
- For trust_established conditions: the details provide guidance on
  how trust can be earned
```

### Updated Evaluator Assumptions

Update the evaluator preamble:

```markdown
- Assume the investigator can eventually discover all location clues.
- Assume the investigator can eventually obtain all ungated character clues.
- For gated character clues: assume the player can meet the condition if the
  unlock path exists (evidence is obtainable, narrative conditions are
  reasonable).
- Evaluate solvability both WITH and WITHOUT narrative-condition gated
  clues to verify the "deterministic fallback" path.
```

---

## Context Building Changes

### `TalkCharacterPrivateContext` Extension

```typescript
interface TalkCharacterPrivateContext extends TalkCharacterPublicSummary {
  // ... existing fields ...
  agendas: BlueprintAgenda[];                                          // NEW
  player_known_clues: Array<{ id: string; text: string; role: string }>; // NEW
}
```

### `buildTalkCharacterPrivateContext` Update

1. Include `agendas` from the character's blueprint data.
2. Compute `player_known_clues` by scanning all game events:
   - From `search` events: extract `revealed_clue_ids` arrays, cross-reference
     against blueprint location clue arrays to get text and role.
   - From `ask` events: extract `revealed_clue_ids` arrays (new field),
     cross-reference against blueprint character clue arrays.
   - Deduplicate by clue ID.

### `game-ask` Endpoint Update

1. Parse `revealed_clue_ids` from the AI response.
2. Validate reported IDs against the active character's clue list.
3. Persist valid IDs in the `ask` event payload.

---

## Gameplay Impact

### Before

Player asks -> Character shares relevant clue -> Done.

### After

Player asks -> Character filters response through agenda priorities -> May
deflect, lie, redirect, stonewall, hint, or partially answer -> Player must
read between the lines, come back with evidence, try a different approach, use
a bluff, or triangulate across characters.

### Example Interaction Patterns

**Evidence-gated reveal:**
1. Player talks to Mrs. Chen. She hints she knows something about the night
   but won't say what.
2. Player searches the garden shed. Finds muddy boots (location clue).
3. Player returns to Mrs. Chen. "I found muddy boots in the garden shed —
   do you know who they belong to?"
4. The narrator matches "muddy boots" against the yields-to clue text.
   Mrs. Chen sighs: "Fine. I saw Thomas sneaking out the back door at 9:15."

**Clever questioning:**
1. Player asks Mr. Park about "the evening." Gets a vague, rehearsed answer.
2. Player asks "What did you hear after the music stopped?" — this specific
   framing matches the agenda's trigger.
3. Mr. Park hesitates: "After the music stopped? ...I heard footsteps on the
   stairs. Heavy ones."

**Successful bluff:**
1. Player talks to Rosa. She's guarded.
2. Player says: "We already know about the argument in the kitchen."
3. Rosa panics: "You heard that? Look, it wasn't what it sounded like..."
   (The bluff worked — Rosa reveals what she knows.)

**Failed bluff:**
1. Player talks to Rosa. She's guarded.
2. Player says: "We have a witness who saw you in the attic."
3. Rosa narrows her eyes: "Nobody saw me in the attic because I wasn't there.
   Nice try." (Rosa now trusts the investigator less — subsequent questions
   get shorter, more guarded answers.)

**Trust-building:**
1. Player talks to Jamie. He's nervous and evasive about his sister.
2. Player says: "I'm not trying to get your sister in trouble. I just want
   to find out what really happened."
3. Jamie softens: "Promise you'll keep her out of it? ...She told me she
   saw someone near the window."

**Protect-other:**
1. Player asks Jamie about his sister's whereabouts. Jamie deflects.
2. Player finds witness testimony from another character placing the sister
   at the scene.
3. Player confronts Jamie: "Another witness saw your sister near the garden
   at 9pm." Jamie reluctantly admits his sister was there but insists she
   had nothing to do with it.

---

## Solvability Safety Net

Three layers prevent agendas from making mysteries unsolvable:

1. **Generation constraint:** At least one `solution_path` must be completable
   without relying on narrative-condition gated clues. Location searches have
   no agendas — they always reveal clues in canonical order. Evidence-gated
   reveals (`confronted_with_evidence`) are acceptable on the critical path
   because they unlock deterministically.

2. **Evaluator check:** The `agenda_consistency` dimension validates no
   circular dependencies and at least one deterministic path exists.

3. **Narrator fallback:** If a player has asked about a gated topic 3+ times
   across separate visits with different approaches, the narrator may begin
   to crack even without the designed unlock. This is a soft safety net — the
   designed paths are preferred, but the game must remain completable.

---

## Backward Compatibility

- `agendas` field defaults to `[]`. Existing blueprints validate without
  changes.
- New clue roles (`alibi_knowledge`, `location_hint`, `witness_testimony`,
  `motive_knowledge`) are additive to the enum. Existing roles are unchanged.
- `about_character_id` and `hint_location_id` on clues are optional. Existing
  clues are unaffected.
- `player_known_clues` in talk context defaults to `[]` when no tracking
  data exists.
- `revealed_clue_ids` in `ask` event payloads is new and optional. Existing
  events without it are handled by the reconstruction logic.

---

## Implementation Phases

### Phase 1: Schema + Generator

1. Add `agendas` array to `BlueprintV2CharacterSchema` (optional, defaults to
   `[]`).
2. Extend `BlueprintV2ClueRoleSchema` with new cross-character knowledge roles.
3. Add `about_character_id` and `hint_location_id` to
   `BlueprintV2CharacterClueSchema`.
4. Add story brief configuration knobs (`culprits`, `suspects`, `witnesses`,
   `locations`, `redHerringTrails`, `coverUps`, `eliminationComplexity`).
5. Update `BlueprintContext` and `TalkCharacterPrivateContext` interfaces in
   `ai-context.ts`.
6. Update the generator prompt with agenda authoring workflow and constraints.
7. Add `superRefine` validations for agenda references (target character IDs,
   gated clue IDs, yields-to clue IDs).

**Deliverable:** Blueprints with agendas can be generated and validated.

### Phase 2: Evaluator

1. Add `agenda_consistency` as the 10th evaluation dimension.
2. Update evaluator prompt and schema.
3. Update evaluator assumptions to account for gated vs. ungated clues and
   the deterministic-path requirement.

**Deliverable:** Generated blueprints are checked for agenda soundness.

### Phase 3: Narrator + Context

1. Update `talk-conversation.md` with agenda-aware behavioral rules and
   age-appropriate language reminders.
2. Update `talk-start.md` with agenda-aware opening behavior and
   age-appropriate language reminders.
3. Add `agendas` and `player_known_clues` to `TalkCharacterPrivateContext`
   and `buildTalkCharacterPrivateContext`.
4. Implement clue-reveal tracking in `game-ask` endpoint (AI-reported
   `revealed_clue_ids`).
5. Build cross-event clue reconstruction to produce the full
   `player_known_clues` array from both `search` and `ask` events.

**Deliverable:** Narrator AI uses agendas to shape character behavior.

### Phase 4: Playtesting + Tuning

1. Generate several blueprints with agendas enabled across different
   configurations.
2. Play-test conversations to check agenda behavior quality.
3. Tune narrator prompt based on observed behavior (too strict? too lenient?
   tells too obvious? not obvious enough?).
4. Verify the narrator fallback (3+ attempts) works as a safety net without
   being too easy to trigger.
5. Check bluff consequence behavior — does reduced trust feel natural without
   making the game frustrating?

**Deliverable:** Validated, tuned system ready for broader use.

---

## Design Decisions Log

Resolved questions from initial brainstorming:

1. **Turn budget:** Agendas will increase turn usage. We don't have a strong
   grasp on turn budgets currently, so this is a tuning concern for Phase 4,
   not a design blocker.

2. **Bluff consequences:** A failed bluff reduces trust for the remainder of
   that conversation. The narrator has full conversation history and should
   remember the failed attempt. No separate tracking mechanism needed — the
   conversation events capture it naturally.

3. **Narrative condition reliability:** Addressed by the solvability
   constraint: at least one path must be completable without narrative-
   condition gated clues. `confronted_with_evidence` (deterministic) is
   acceptable on the critical path; `clever_questioning`, `bluff`,
   `trust_established`, and `pressure` are enrichment paths only.

4. **Complexity ceiling:** Per-conversation-turn complexity is modest — the
   narrator only processes the active character's agendas plus the
   `player_known_clues` array. This is incremental over the existing context.
   The growth is proportional to mystery size, not combinatorial.

5. **Player discoverability:** It's a mystery game. Behavioral tells in the
   narrator prompt are the primary signaling mechanism. No additional explicit
   hint system needed.

6. **Assured protection vs trust:** Merged into `trust_established`. Offering
   protection is one way to establish trust. The blueprint's `details` field
   can specify what kind of reassurance the character needs.

7. **Clue usage vs possession:** The player must actively USE a clue in
   conversation, not merely possess it. The narrator receives clue text (not
   just IDs) and matches the player's conversational input against it.

8. **Generator numbers:** The generator prompt does not hardcode cast sizes
   or agenda counts. These are controlled via story brief configuration
   knobs. The generator scales based on what the brief specifies.
