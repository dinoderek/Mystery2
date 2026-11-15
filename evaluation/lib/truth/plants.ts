/**
 * Planting by code. A plant is applied to its base, never made by hand, so a
 * variant is always rebuilt from the base it came from, byte for byte, and is
 * never stored. A turn variant gives a game, a blueprint plant a blueprint.
 *
 * Applying a plant fails, naming it, when its target is not where it says
 * (text not found, a `test` that does not hold, a path that is not there), and
 * when the result is no longer a valid subject for the schema every reader
 * uses. What the checks report about the result is `plant-checks.ts`.
 */

import type { SafeParseReturnType } from "zod";

import { BlueprintV2Schema } from "../../../packages/shared/src/blueprint-schema-v2.ts";
import { applyPatch } from "./patch.ts";
import type { BlueprintPlant, StoredGame, TurnEdit, TurnPlant, TurnVariant } from "./schemas.ts";
import { StoredGameSchema } from "./schemas.ts";

/** A plant that cannot be applied, or leaves a subject no reader accepts. The message names the plant. */
export class PlantError extends Error {
  readonly plant: string;

  constructor(plant: string, detail: string) {
    super(`${plant}: ${detail}`);
    this.name = "PlantError";
    this.plant = plant;
  }
}

export type NamedTurnVariant = TurnVariant & { id: string };
export type NamedBlueprintPlant = BlueprintPlant & { id: string };

/** A turn variant applied: the game, and where each plant changed it. */
export interface BuiltGame {
  trace: StoredGame;
  plants: { sequence: number; touched: string[] }[];
}

/** A blueprint plant applied: the blueprint, and where the patch changed it. */
export interface BuiltBlueprint {
  blueprint: unknown;
  touched: string[];
}

type StoredEvent = StoredGame["events"][number];
type Fail = (detail: string) => never;

function turnLabel(variant: NamedTurnVariant, plant: TurnPlant): string {
  return `variant "${variant.id}", turn ${plant.sequence} (${plant.kind})`;
}

function blueprintLabel(plant: NamedBlueprintPlant): string {
  return `plant "${plant.id}" (${plant.kind}) on base "${plant.base}"`;
}

/** `text` with its one occurrence of `find` replaced; fails when there is none or several. */
function replaceOnce(text: string, edit: Extract<TurnEdit, { type: "narration" }>, where: string, fail: Fail): string {
  const pieces = text.split(edit.find);
  if (pieces.length === 1) fail(`the text ${JSON.stringify(edit.find)} is not in the ${where}`);
  if (pieces.length > 2) fail(`the text ${JSON.stringify(edit.find)} is in the ${where} ${pieces.length - 1} times; it must name one place`);
  return pieces.join(edit.replace);
}

/** A narration edit: the event's narration, and every narration part that holds the same words. */
function editNarration(event: StoredEvent, edit: Extract<TurnEdit, { type: "narration" }>, fail: Fail): string[] {
  event.narration = replaceOnce(event.narration, edit, "narration", fail);
  const touched = ["/narration"];
  event.narration_parts.forEach((part, at) => {
    const text = (part as { text?: unknown } | null)?.text;
    if (typeof text !== "string" || !text.includes(edit.find)) return;
    (part as { text: string }).text = replaceOnce(text, edit, `narration part ${at}`, fail);
    touched.push(`/narration_parts/${at}/text`);
  });
  return touched;
}

function editEvent(event: StoredEvent, edit: TurnEdit, index: number, fail: Fail): { event: StoredEvent; touched: string[] } {
  if (edit.type === "narration") return { event, touched: editNarration(event, edit, fail) };
  try {
    const patched = applyPatch(event, edit.ops);
    return { event: patched.value, touched: patched.touched };
  } catch (error) {
    return fail(`edit ${index + 1}: ${(error as Error).message}`);
  }
}

function applyTurnPlant(trace: StoredGame, variant: NamedTurnVariant, plant: TurnPlant): string[] {
  const label = turnLabel(variant, plant);
  const at = trace.events.findIndex((event) => event.sequence === plant.sequence);
  if (at < 0) throw new PlantError(label, `the game has no turn ${plant.sequence}`);
  const original = trace.events[at];
  let event = structuredClone(original);
  const touched: string[] = [];
  plant.edits.forEach((edit, index) => {
    const fail: Fail = (detail) => {
      throw new PlantError(label, detail);
    };
    const edited = editEvent(event, edit, index, fail);
    event = edited.event;
    touched.push(...edited.touched);
  });
  for (const field of ["sequence", "event_type", "id"] as const) {
    if (event[field] !== original[field]) throw new PlantError(label, `an edit changed the turn's ${field}, which names the turn`);
  }
  trace.events[at] = event;
  return touched.map((path) => `/events/${at}${path}`);
}

function requireValid(label: string, parsed: SafeParseReturnType<unknown, unknown>): void {
  if (parsed.success) return;
  const issues = parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
  throw new PlantError(label, `the result is not a valid subject: ${issues.join("; ")}`);
}

/**
 * The game a turn variant makes: a copy of `game` with each plant's edits
 * applied to its turn. At most one plant to a turn.
 */
export function buildGameVariant(game: StoredGame, variant: NamedTurnVariant): BuiltGame {
  const trace = structuredClone(game);
  const seen = new Set<number>();
  const plants = variant.plants.map((plant) => {
    if (seen.has(plant.sequence)) {
      throw new PlantError(turnLabel(variant, plant), `turn ${plant.sequence} already has a plant; a turn takes one`);
    }
    seen.add(plant.sequence);
    return { sequence: plant.sequence, touched: applyTurnPlant(trace, variant, plant) };
  });
  requireValid(`variant "${variant.id}"`, StoredGameSchema.safeParse(trace));
  return { trace, plants };
}

/** The blueprint a plant makes: a copy of `base` with its patch applied, which must still pass Blueprint V2. */
export function buildBlueprintVariant(base: unknown, plant: NamedBlueprintPlant): BuiltBlueprint {
  const label = blueprintLabel(plant);
  let patched;
  try {
    patched = applyPatch(base, plant.patch);
  } catch (error) {
    throw new PlantError(label, (error as Error).message);
  }
  requireValid(label, BlueprintV2Schema.safeParse(patched.value));
  return { blueprint: patched.value, touched: patched.touched };
}
