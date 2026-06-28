// Age-readability cases — each is ONE deterministic interaction event.
//
// A case fixes the entire prior state (`given`, including the full `history`)
// and the single `action` under test, so the model input is identical every run
// and across models. No turn accumulation, no divergence: swap the backend or
// ai_profile/model and you are comparing apples to apples on the same input.
//
// The mock blueprint targets age 10 (≈ US grade 5). `history` rows mirror how the
// runtime stores game_events (event_type/actor/narration/payload), so the same
// data drives both backends: the endpoint backend seeds these as rows; the CLI
// backend feeds them to the context builder.
//
// This file exports a LIST of cases; run.mjs accepts a single case or a list.

const blueprint = { path: "supabase/seed/blueprints/mock-blueprint.json" };

/** Mid-conversation question to the culprit — the richest readability signal. */
const askAlibiPressure = {
  id: "ask-alice-alibi-pressure",
  blueprint,
  given: {
    mode: "talk",
    location_id: "loc-kitchen",
    talk_character_id: "char-alice",
    time_remaining: 7,
    history: [
      {
        event_type: "talk",
        actor: "system",
        narration: "You step closer to Alice by the kitchen counter. She gives you a quick, tight smile.",
        payload: { character_id: "char-alice" },
      },
      {
        event_type: "ask",
        actor: "system",
        narration: "\"The cookies? I never even went near the jar,\" Alice says, folding her arms.",
        payload: { character_id: "char-alice", player_input: "Did you take the cookies?" },
      },
    ],
  },
  action: { type: "ask", player_input: "Then why are your hands shaking?" },
  judges: ["flesch"],
  judgeConfig: { flesch: { tolerance: 2 } },
};

/** Opening a conversation cold — narrator scene-setting prose. */
const talkBobOpen = {
  id: "talk-bob-open",
  blueprint,
  given: {
    mode: "explore",
    location_id: "loc-living-room",
    time_remaining: 8,
    history: [],
  },
  action: { type: "talk", character_id: "char-bob" },
  judges: ["flesch"],
  judgeConfig: { flesch: { tolerance: 2 } },
};

export default [askAlibiPressure, talkBobOpen];
