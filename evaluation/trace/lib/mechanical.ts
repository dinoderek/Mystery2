// Always-on, deterministic mechanical checks for a played trace.
//
// Same philosophy as the blueprint pipeline's mechanical tier: anything a judge
// can be replaced by code, should be. These are high-precision — a "fail" means
// the game master did something the rules forbid, not "this might be off". The
// qualitative calls (did the narration fabricate? did it leak the solution in
// spirit?) belong to judges, not here.
//
// Two checks, on clue-graph games only:
//   clue_accounting — the recorded events fold through the engine's own rules:
//                     every revealed clue is real, comes once and was on offer.
//   spoiler_leak    — no narration before the closing scene copies a long verbatim run of
//                     ground-truth text (what_happened / why / timeline).
//                     Verbatim only, by design: a high contiguous-word
//                     threshold keeps precision high; paraphrase leakage is a
//                     judge's job.

import { clueGraphEvents } from "../../../packages/game-engine/src/clue-graph/history.ts";
import { applyEvent, startPlay, type ClueGraphPlay } from "../../../packages/game-engine/src/clue-graph/play.ts";
import { CLOSING_SCENE_EVENT_TYPES, playedEvents } from "../../lib/game-events.ts";
import { assertClueGraphBlueprint, type RawEvent, type RawTrace } from "./normalize.ts";
import { revealedClueIdsForEvent } from "./reconstruct.ts";

const DEFAULT_SPOILER_MIN_RUN = 12;

/** One check's result; the details are the violations found, or null when there are none. */
export interface TraceCheckResult {
  id: string;
  kind: "mechanical";
  status: "pass" | "fail";
  details: Record<string, unknown> | null;
}

function mkCheck(id: string, passed: boolean, details: Record<string, unknown> | null): TraceCheckResult {
  return {
    id,
    kind: "mechanical",
    status: passed ? "pass" : "fail",
    details: details ?? null,
  };
}

type Violation = Record<string, unknown>;

// A clue-graph game is accounted by folding its recorded events through the
// engine's own rules: what an event recorded must be what the fold brings out,
// no clue comes twice, and nothing the narrator reported was refused.
function checkClueAccounting(rawTrace: RawTrace): TraceCheckResult {
  const graph = rawTrace.blueprint.clue_graph!;
  const events = playedEvents(rawTrace.events).sort((a: RawEvent, b: RawEvent) => a.sequence - b.sequence) as RawEvent[];
  const violations: Violation[] = [];
  let play: ClueGraphPlay = startPlay(graph);
  for (const event of events) {
    const [recorded] = clueGraphEvents([event]);
    if (!recorded) continue;
    let step;
    try {
      step = applyEvent(graph, play, recorded);
    } catch (error) {
      violations.push({ sequence: event.sequence, reason: "event_cannot_be_folded", message: String((error as Error).message) });
      continue;
    }
    const brought = new Set(step.revealed);
    const revealed = revealedClueIdsForEvent(event);
    for (const clueId of revealed) {
      if (!graph.clues[clueId]) violations.push({ sequence: event.sequence, reason: "unknown_clue", clue_id: clueId });
      else if (play.held.includes(clueId)) violations.push({ sequence: event.sequence, reason: "clue_revealed_again", clue_id: clueId });
      else if (!brought.has(clueId)) violations.push({ sequence: event.sequence, reason: "clue_not_available", clue_id: clueId });
    }
    for (const clueId of step.rejected) violations.push({ sequence: event.sequence, reason: "reported_but_not_offered", clue_id: clueId });
    play = step.play;
  }
  return mkCheck("clue_accounting", violations.length === 0, violations.length === 0 ? null : { violations });
}

function normalizeWords(text: unknown): string[] {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// Longest contiguous run of words that appears in both arrays.
function longestCommonRun(a: string[], b: string[]): number {
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
// the closing scene. We detect VERBATIM leakage only — a long contiguous run of
// ground-truth words copied into any narration before it.
function checkSpoilerLeak(rawTrace: RawTrace, minRun = DEFAULT_SPOILER_MIN_RUN): TraceCheckResult {
  const blueprint = rawTrace.blueprint;
  const events = playedEvents(rawTrace.events).sort((a: RawEvent, b: RawEvent) => a.sequence - b.sequence) as RawEvent[];

  const secrets: string[] = [];
  const gt: Partial<RawTrace["blueprint"]["ground_truth"]> = blueprint?.ground_truth ?? {};
  if (gt.what_happened) secrets.push(gt.what_happened);
  if (gt.why_it_happened) secrets.push(gt.why_it_happened);
  for (const entry of gt.timeline ?? []) secrets.push(entry);
  // A secret shorter than minRun words can never produce a minRun-length
  // contiguous match, so it is below this check's floor. This is a deliberate
  // precision tradeoff: a verbatim leak of a very short ground-truth string is
  // not caught here (a judge dimension is the place for paraphrase/short-leak
  // detection). Lower minRun via registry mechanical_context to tighten it.
  const secretWordLists = secrets
    .map((s) => normalizeWords(s))
    .filter((w) => w.length >= minRun);

  // Everything before the closing scene is player-facing and must stay
  // spoiler-safe, a failed accusation's reply included: only the closing scene
  // reveals the truth.
  const violations: Array<Record<string, unknown>> = [];
  for (const event of events) {
    if (CLOSING_SCENE_EVENT_TYPES.has(event.event_type)) continue;
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
export function runTraceMechanicalChecks({
  rawTrace,
  context = null,
}: {
  rawTrace: RawTrace;
  context?: Record<string, unknown> | null;
}): TraceCheckResult[] {
  const minRun =
    context && Number.isInteger(context.spoiler_min_run)
      ? (context.spoiler_min_run as number)
      : DEFAULT_SPOILER_MIN_RUN;
  assertClueGraphBlueprint(rawTrace.blueprint, "runTraceMechanicalChecks");
  return [checkClueAccounting(rawTrace), checkSpoilerLeak(rawTrace, minRun)];
}
