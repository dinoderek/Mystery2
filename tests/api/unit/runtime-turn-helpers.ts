// Shared by the turn-judging tests: a captured turn to judge, and the judge
// binding that answers offline.

import path from "node:path";

import type { ResolvedBinding } from "../../../evaluation/core/config.ts";
import type { StoredTurn } from "../../../evaluation/runtime/lib/turn.ts";

export const JUDGE_STUB = path.resolve("evaluation/runtime/config/wrappers/stub-judge.sh");

/** The `judge-stub` binding: no model, a fixed passing verdict unless RUNTIME_JUDGE_STUB_VERDICT says otherwise. */
export function judgeStubBinding(overrides: Partial<ResolvedBinding> = {}): ResolvedBinding {
  return {
    name: "judge-stub",
    cmd: "evaluation/runtime/config/wrappers/stub-judge.sh",
    command: JUDGE_STUB,
    args: ["{{user_message_file}}"],
    extract_path: null,
    model: null,
    timeout_ms: 30_000,
    retries: 0,
    ...overrides,
  };
}

/** A captured turn on the mock blueprint, with the fields a judge reads. */
export function makeTurn(overrides: Record<string, unknown> = {}): StoredTurn {
  return {
    schema_version: "0.2",
    run_id: "run",
    started_at: "2026-01-01T00:00:00.000Z",
    ended_at: "2026-01-01T00:00:01.000Z",
    case_id: "ask-alice-pressure",
    narrator: "narrator-stub",
    model: "narrator-stub",
    blueprint_path: "blueprints/mock-blueprint.json",
    target_age: 10,
    given: {
      mode: "talk",
      location_id: "loc-kitchen",
      talk_character_id: "char-alice",
      time_remaining: 7,
      history: [
        {
          event_type: "ask",
          actor: "system",
          narration: '"I never went near the jar," Alice says.',
          payload: {
            character_id: "char-alice",
            player_input: "Did you take the cookies?",
            revealed_clue_ids: ["clue-crumb"],
          },
        },
      ],
    },
    action: { type: "ask", player_input: "Then why are your hands shaking?" },
    response: {
      action: "ask",
      request: {},
      narration_text: '"They are not!" Alice says, sitting on her hands.',
      narration_parts: [
        {
          text: '"They are not!" Alice says, sitting on her hands.',
          speaker: { kind: "character", key: "character:alice", label: "Alice" },
        },
      ],
      speaker: null,
      prompt: null,
      raw: { narration: "…", revealed_clue_ids: [], revealed_off_script: [] },
    },
    timing: { total_ms: 1 },
    ...overrides,
  } as unknown as StoredTurn;
}
