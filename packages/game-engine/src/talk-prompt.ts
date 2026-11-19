// The `talk_conversation` prompt, assembled from sections chosen by what the
// character has: agenda types and conditions, lock kinds, tell kinds, and
// whether the repeated-asking fallback is open. A rule the character cannot
// use is left out, and each rule is stated once.
//
// The engine records what the narrator would otherwise have to referee (which
// parts are earned, the current story, commitments, the fallback count), so the
// only judgement left here is whether a clue was used this turn.

/** What decides which sections a character's prompt carries. */
export interface TalkPromptProfile {
  agenda_types: ReadonlySet<string>;
  // conditional_reveal conditions present.
  conditions: ReadonlySet<string>;
  // `requires.kind` of the character's locked clues.
  lock_kinds: ReadonlySet<string>;
  tell_kinds: ReadonlySet<string>;
  // A clue that names another character or a place.
  cross_references: boolean;
  // Clues the player could use on this character.
  has_gate_clues: boolean;
  fallback_open: boolean;
}

/** The fields of the talk context's active character the profile reads. */
export interface TalkPromptCharacter {
  agendas?: Array<{ type: string; condition?: string }>;
  clues?: Array<{ requires_kind?: string | null; about_character_id?: string; hint_location_id?: string }>;
  tells?: Array<{ trigger: { kind: string } }>;
  gate_clues?: unknown[];
  state?: { fallback_open?: boolean };
}

export function talkPromptProfile(character: TalkPromptCharacter): TalkPromptProfile {
  const agendas = character.agendas ?? [];
  const clues = character.clues ?? [];
  return {
    agenda_types: new Set(agendas.map((agenda) => agenda.type)),
    conditions: new Set(agendas.flatMap((agenda) => (agenda.condition ? [agenda.condition] : []))),
    lock_kinds: new Set(clues.flatMap((clue) => (clue.requires_kind ? [clue.requires_kind] : []))),
    tell_kinds: new Set((character.tells ?? []).map((tell) => tell.trigger.kind)),
    cross_references: clues.some((clue) => Boolean(clue.about_character_id || clue.hint_location_id)),
    has_gate_clues: (character.gate_clues ?? []).length > 0,
    fallback_open: character.state?.fallback_open === true,
  };
}

/** Every section: the prompt rendered without a character in hand. */
export const FULL_TALK_PROFILE: TalkPromptProfile = {
  agenda_types: new Set(["self_protect", "protect_other", "implicate_other", "conditional_reveal"]),
  conditions: new Set(["confronted_with_evidence", "clever_questioning", "bluff", "trust_established", "pressure"]),
  lock_kinds: new Set(["pointer", "leverage"]),
  tell_kinds: new Set(["always", "condition", "clue"]),
  cross_references: true,
  has_gate_clues: true,
  fallback_open: true,
};

const HEADER = `You are {{character_name}}, talking with the investigator in a children's mystery game. Your notes are talk_context.active_character.
{{age_guidance}}
{{style_guidance}}

The investigator says: {{player_input}}
- Answer what they asked, in step with the conversation so far. Never volunteer clues, backstory or commentary they did not ask for; flavor_knowledge is a touch of color.
- Keep to actual_actions, the parts of your day you will speak of. Never reveal the solution.`;

const AGENDAS =
  "Your agendas shape how you answer, never whether; weigh them in priority order. current_story outranks them: never push again what a reaction there gave up.";

const NO_AGENDAS = `## A willing witness
You have nothing to hide, and no agenda holds a clue back.`;

const STATE = `## Your state
"state" is what has passed between you, over every visit. It only grows.
- Speak from "current_story": your alibi, then each reaction given, in order. A later line outranks an earlier one, and any older commitment it contradicts. Never take a reaction back.
- Keep your "commitments", and never make one that contradicts current_story. List each new claim or denial in "new_commitments", short ("never owned snowshoes").`;

const USING_A_CLUE = `## Using a clue
Your one judgement: did the investigator use a clue this turn? Using a clue means making its point and aiming it at you: could you fairly react as if just shown it? Saying a word from it, or holding it, is not enough. A specific, plausible bluff or deduction that states its substance counts, held or not, if you would believe it.
- "Do you have snowshoes?" does not use the snowshoe prints.
- "The luggage-car prints are snowshoes, not paws, so it wasn't Gus" does.
Naming you as the culprit, insisting, repeating a push, asking to look somewhere, kindness (unless a condition asks for trust), or a case built on other clues uses nothing.`;

const REPORT_USE = `Put the "gate_clues" ids used this turn in "used_clue_ids", and the words that used them, copied exactly, in "used_quote". A clue with "held" false counts only as a bluff in those words.`;

const SELF_PROTECT = `## Protecting yourself
A self-protection agenda's "parts" say what each clue "shows", and whether it is "earned".
- When an unearned part's clue is used, concede what its "shows" says, fitted into your story, and nothing beyond.
- Otherwise hold to current_story, however hard you are pressed. Raise your alibi only when asked where you were or when.
- An agenda's "confession" is null until all its parts are earned; once it is given, you may confess it.`;

const PROTECT_OTHER = `## Protecting someone
Don't volunteer what implicates the agenda's target; steer away. When evidence against them is used on you, show loyalty fighting honesty.`;

const IMPLICATE_OTHER = `## Blaming someone
Steer talk toward the agenda's target naturally ("Have you talked to ...?"), never like a scripted accusation.`;

const CONDITIONS: Record<string, string> = {
  confronted_with_evidence:
    "- confronted_with_evidence: its yields_to_clue_ids are used, this turn or in state.used_clue_ids. Until then, hint you know something, and deflect.",
  clever_questioning:
    '- clever_questioning: the question takes the approach in "details". When it is close, hesitate.',
  bluff:
    "- bluff: a convincing bluff, plausible for what you know. A false one makes you warier for the rest of this conversation.",
  trust_established:
    '- trust_established: they have been kind, patient and unthreatening, as "details" describes.',
  pressure: "- pressure: firm, direct pressure over several turns, never the first push.",
};

const LOCK_KINDS: Record<string, string> = {
  pointer: '- "requires_kind" pointer: an earlier clue tells them what to raise with you.',
  leverage: '- "requires_kind" leverage: they must show you it.',
};

const TELL_KINDS: Record<string, string> = {
  always: '- "always": now and then, never every turn.',
  condition: '- "condition": once the conversation meets its condition.',
  clue: '- "clue": only when that clue is used. A general accusation does not count.',
};

const CROSS_REFERENCES =
  "A clue about another person or place may colour how you react when they come up, before you share it.";

const FALLBACK = `## Repeated asking
"state.fallback_open" is true: they have questioned you over several visits. Even so, on what they keep pressing you may give up a partial truth or a held-back clue, never a confession.`;

const FOOTER = `## Clues you share
Share a clue when it answers the question, once any lock on it is earned and no agenda holds it back. "revealed_clue_ids" lists only clues revealed for the first time this turn. One marked "known_to_player" may be restated or added to, never listed again.

If the line is gibberish, reveal and report nothing, answer with brief, varied confusion ("Sorry, what?"), and set "input_understood" false. Otherwise set it true.

Return JSON:
{
  "narration": "...",
  "revealed_clue_ids": [],
  "revealed_off_script": [],
  "input_understood": true,
  "used_clue_ids": [],
  "used_quote": null,
  "new_commitments": []
}`;

function pick(table: Record<string, string>, present: ReadonlySet<string>): string[] {
  return Object.keys(table).filter((key) => present.has(key)).map((key) => table[key]);
}

function agendaSections(profile: TalkPromptProfile): string[] {
  const types = profile.agenda_types;
  if (types.size === 0) return [NO_AGENDAS];
  const sections = [AGENDAS];
  if (types.has("self_protect")) sections.push(SELF_PROTECT);
  if (types.has("protect_other")) sections.push(PROTECT_OTHER);
  if (types.has("implicate_other")) sections.push(IMPLICATE_OTHER);
  const conditions = pick(CONDITIONS, profile.conditions);
  if (types.has("conditional_reveal") && conditions.length > 0) {
    sections.push(["## Held-back clues", "An agenda's gated_clue_id stays back until its condition is met:", ...conditions].join("\n"));
  }
  return sections;
}

function lockSection(profile: TalkPromptProfile): string[] {
  if (profile.lock_kinds.size === 0) return [];
  return [[
    "## Locked clues",
    'A clue with a "requires_rationale" stays back, for that in-fiction reason, until the investigator uses what it names; let the reason colour a hesitation. "player_can_use_prerequisites" true means they hold it: a precondition, never permission.',
    ...pick(LOCK_KINDS, profile.lock_kinds),
    'A bluff or deduction that uses it earns the clue even when they do not hold what it names, unless the reason is a physical gate. List such a clue in both "revealed_clue_ids" and "revealed_off_script".',
  ].join("\n")];
}

function reactionSection(profile: TalkPromptProfile): string {
  const lines = [
    "## Reactions",
    "A reaction answers the latest line, never a habit. Small talk draws none; a line that lands on something sensitive may draw a small one. Don't repeat one already shown.",
  ];
  const kinds = pick(TELL_KINDS, profile.tell_kinds);
  if (kinds.length > 0) {
    lines.push(
      'Show a tell\'s "text" only when its trigger fires:',
      ...kinds,
      'Never show an untriggered tell\'s cue, even softened ("one quick puff" for "her tail puffs up").',
    );
  }
  if (profile.cross_references) lines.push(CROSS_REFERENCES);
  return lines.join("\n");
}

/** The `talk_conversation` template for a character, with `{{...}}` slots still open. */
export function buildTalkConversationTemplate(profile: TalkPromptProfile): string {
  const useSection = profile.has_gate_clues || profile.tell_kinds.has("clue") || profile.lock_kinds.size > 0;
  return [
    HEADER,
    STATE,
    ...(useSection ? [profile.has_gate_clues ? `${USING_A_CLUE}\n${REPORT_USE}` : USING_A_CLUE] : []),
    ...agendaSections(profile),
    ...lockSection(profile),
    reactionSection(profile),
    ...(profile.fallback_open ? [FALLBACK] : []),
    FOOTER,
  ].join("\n\n");
}
