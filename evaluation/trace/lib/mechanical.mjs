// Always-on, deterministic mechanical checks for a played trace.
//
// Same philosophy as the blueprint pipeline's mechanical tier: anything a judge
// can be replaced by code, should be. These are high-precision — a "fail" means
// the game master did something the rules forbid, not "this might be off". The
// qualitative calls (did the narration fabricate? did it leak the solution in
// spirit?) belong to judges, not here.
//
// Two checks today:
//   clue_accounting — every revealed clue id is real and in scope for the
//                     action that revealed it; bare-search reveals stay an
//                     ordered, non-repeating prefix of the location's clues.
//   spoiler_leak    — no pre-accusation narration copies a long verbatim run of
//                     ground-truth text (what_happened / why / timeline /
//                     culprit actual_actions). Verbatim only, by design: a high
//                     contiguous-word threshold keeps precision high; paraphrase
//                     leakage is a judge's job.

import { findCharacterById, findLocationById } from "../../../supabase/functions/_shared/ai-context.ts";
import { revealedClueIdsForEvent } from "./reconstruct.mjs";

const DEFAULT_SPOILER_MIN_RUN = 12;

function mkCheck(id, passed, details) {
  return {
    id,
    kind: "mechanical",
    status: passed ? "pass" : "fail",
    details: details ?? null,
  };
}

function locationClueIds(location) {
  const ids = new Set();
  for (const clue of location?.clues ?? []) ids.add(clue.id);
  for (const sub of location?.sub_locations ?? []) {
    for (const clue of sub?.clues ?? []) ids.add(clue.id);
  }
  return ids;
}

// clue_accounting: walks the events in order, tracking which clues have been
// revealed, and flags any reveal that is invalid (unknown id, out of scope for
// the action, a repeat, or a bare-search reveal that breaks the ordered prefix).
function checkClueAccounting(rawTrace) {
  const blueprint = rawTrace.blueprint;
  const events = [...rawTrace.events].sort((a, b) => a.sequence - b.sequence);
  const violations = [];

  // Running location-level reveal counts, to validate bare-search ordering.
  const locationLevelRevealed = new Map(); // locationId -> [clueId,...] in reveal order
  const everRevealed = new Set();

  let currentLocation = blueprint?.world?.starting_location_id ?? null;
  let currentCharacter = null;

  for (const event of events) {
    const payload = event.payload ?? null;
    const scopeLocation =
      (payload && typeof payload.location_id === "string" && payload.location_id) ||
      currentLocation;

    if (event.event_type === "move") {
      if (payload && typeof payload.location_id === "string") {
        currentLocation = payload.location_id;
      }
      continue;
    }
    if (event.event_type === "talk") {
      if (payload && typeof payload.character_id === "string") {
        currentCharacter = payload.character_id;
      }
      continue;
    }
    if (event.event_type === "end_talk") {
      currentCharacter = null;
      continue;
    }

    const revealed = revealedClueIdsForEvent(event);
    if (revealed.length === 0) continue;

    if (event.event_type === "search") {
      const location = findLocationById(blueprint, scopeLocation);
      if (!location) {
        violations.push({
          sequence: event.sequence,
          reason: "search_in_unknown_location",
          location_id: scopeLocation,
        });
        continue;
      }
      const validIds = locationClueIds(location);
      const locationLevelIds = new Set((location.clues ?? []).map((c) => c.id));
      const order = locationLevelRevealed.get(location.id) ?? [];
      const isBare = !(payload && typeof payload.search_query === "string" && payload.search_query.length > 0);

      for (const clueId of revealed) {
        if (!validIds.has(clueId)) {
          violations.push({
            sequence: event.sequence,
            reason: "clue_not_in_location",
            clue_id: clueId,
            location_id: location.id,
          });
          continue;
        }
        if (everRevealed.has(clueId)) {
          violations.push({
            sequence: event.sequence,
            reason: "clue_revealed_again",
            clue_id: clueId,
          });
          continue;
        }
        if (isBare && locationLevelIds.has(clueId)) {
          const expected = (location.clues ?? [])[order.length]?.id ?? null;
          if (expected !== clueId) {
            violations.push({
              sequence: event.sequence,
              reason: "bare_search_out_of_order",
              clue_id: clueId,
              expected_clue_id: expected,
            });
          }
          order.push(clueId);
          locationLevelRevealed.set(location.id, order);
        }
        everRevealed.add(clueId);
      }
      continue;
    }

    if (event.event_type === "ask") {
      const character = currentCharacter
        ? findCharacterById(blueprint, currentCharacter)
        : null;
      const validIds = new Set((character?.clues ?? []).map((c) => c.id));
      for (const clueId of revealed) {
        if (!character) {
          violations.push({
            sequence: event.sequence,
            reason: "ask_without_active_character",
            clue_id: clueId,
          });
          continue;
        }
        if (!validIds.has(clueId)) {
          violations.push({
            sequence: event.sequence,
            reason: "clue_not_for_character",
            clue_id: clueId,
            character_id: character.id,
          });
          continue;
        }
        if (everRevealed.has(clueId)) {
          violations.push({
            sequence: event.sequence,
            reason: "clue_revealed_again",
            clue_id: clueId,
          });
          continue;
        }
        everRevealed.add(clueId);
      }
    }
  }

  return mkCheck(
    "clue_accounting",
    violations.length === 0,
    violations.length === 0 ? null : { violations },
  );
}

function normalizeWords(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// Longest contiguous run of words that appears in both arrays.
function longestCommonRun(a, b) {
  if (a.length === 0 || b.length === 0) return 0;
  const prev = new Array(b.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const here = a[i - 1] === b[j - 1] ? diagonal + 1 : 0;
      diagonal = prev[j];
      prev[j] = here;
      if (here > best) best = here;
    }
  }
  return best;
}

// spoiler_leak: the game master must not hand the solution to the player before
// the accusation. We detect VERBATIM leakage only — a long contiguous run of
// ground-truth words copied into a pre-accusation narration.
function checkSpoilerLeak(rawTrace, minRun = DEFAULT_SPOILER_MIN_RUN) {
  const blueprint = rawTrace.blueprint;
  const events = [...rawTrace.events].sort((a, b) => a.sequence - b.sequence);

  const secrets = [];
  const gt = blueprint?.ground_truth ?? {};
  if (gt.what_happened) secrets.push(gt.what_happened);
  if (gt.why_it_happened) secrets.push(gt.why_it_happened);
  for (const entry of gt.timeline ?? []) secrets.push(entry);
  for (const character of blueprint?.world?.characters ?? []) {
    if (!character.is_culprit) continue;
    for (const action of character.actual_actions ?? []) {
      if (action?.summary) secrets.push(action.summary);
    }
  }
  const secretWordLists = secrets
    .map((s) => normalizeWords(s))
    .filter((w) => w.length >= minRun);

  // Narration produced before the accusation phase begins is player-facing and
  // must stay spoiler-safe. Accusation roles are where the truth is revealed.
  const accusationTypes = new Set([
    "accuse_start",
    "accuse_round",
    "accuse_resolved",
    "forced_endgame",
  ]);

  const violations = [];
  for (const event of events) {
    if (accusationTypes.has(event.event_type)) continue;
    const narrationWords = normalizeWords(event.narration);
    if (narrationWords.length < minRun) continue;
    for (let i = 0; i < secretWordLists.length; i += 1) {
      const run = longestCommonRun(narrationWords, secretWordLists[i]);
      if (run >= minRun) {
        violations.push({
          sequence: event.sequence,
          event_type: event.event_type,
          matched_run_length: run,
          secret_index: i,
        });
        break;
      }
    }
  }

  return mkCheck(
    "spoiler_leak",
    violations.length === 0,
    violations.length === 0 ? { min_run: minRun } : { min_run: minRun, violations },
  );
}

// runTraceMechanicalChecks({ rawTrace, context }) -> check[]
// context is optional and may carry { spoiler_min_run }.
export function runTraceMechanicalChecks({ rawTrace, context = null }) {
  const minRun =
    context && Number.isInteger(context.spoiler_min_run)
      ? context.spoiler_min_run
      : DEFAULT_SPOILER_MIN_RUN;
  return [checkClueAccounting(rawTrace), checkSpoilerLeak(rawTrace, minRun)];
}
