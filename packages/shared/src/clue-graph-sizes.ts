import { z } from "zod";

/**
 * Story sizes (`docs/clue-graph.md`, "Sizes"). A case that declares a
 * `metadata.size` is held to that size's counts, each a floor or a range; its
 * `metadata.size_overrides` replace any of them, so the case can be checked
 * alone, brief or no brief. What each count measures is in
 * `clue-graph-story.ts`.
 */

export const CLUE_GRAPH_SIZES = ["small", "medium", "large"] as const;
export type ClueGraphSize = (typeof CLUE_GRAPH_SIZES)[number];

export const SIZE_COUNTS = [
  "time_budget",
  "locations",
  "suspects",
  "witnesses",
  "clues",
  "gated_clues",
  "false_statements",
  "hidden_spots",
  "shortest_route",
  "culprit_routes",
  "false_alibis",
  "cleared_on_every_route",
] as const;
export type SizeCount = (typeof SIZE_COUNTS)[number];

/** A count's bounds: at least `min`, and at most `max` when it is given. */
export interface CountRange {
  min: number;
  max?: number;
}

const exactly = (count: number): CountRange => ({ min: count, max: count });
const atLeast = (count: number): CountRange => ({ min: count });

export const SIZE_TABLE: Record<ClueGraphSize, Record<SizeCount, CountRange>> = {
  small: {
    time_budget: exactly(8),
    locations: exactly(3),
    suspects: exactly(1),
    witnesses: exactly(2),
    clues: { min: 15, max: 20 },
    gated_clues: atLeast(3),
    false_statements: atLeast(1),
    hidden_spots: atLeast(0),
    shortest_route: atLeast(3),
    culprit_routes: atLeast(2),
    false_alibis: atLeast(0),
    cleared_on_every_route: atLeast(0),
  },
  medium: {
    time_budget: exactly(12),
    locations: exactly(4),
    suspects: exactly(2),
    witnesses: exactly(2),
    clues: { min: 25, max: 35 },
    gated_clues: atLeast(5),
    false_statements: atLeast(2),
    hidden_spots: atLeast(1),
    shortest_route: atLeast(4),
    culprit_routes: atLeast(2),
    false_alibis: atLeast(1),
    cleared_on_every_route: atLeast(0),
  },
  large: {
    time_budget: exactly(16),
    locations: exactly(6),
    suspects: exactly(3),
    witnesses: exactly(3),
    clues: { min: 40, max: 55 },
    gated_clues: atLeast(8),
    false_statements: atLeast(4),
    hidden_spots: atLeast(2),
    shortest_route: atLeast(5),
    culprit_routes: atLeast(3),
    false_alibis: atLeast(1),
    cleared_on_every_route: atLeast(1),
  },
};

const count = z.number().int().min(0).safe();

export const CountRangeSchema = z
  .object({ min: count, max: count.optional() })
  .strict()
  .refine((range) => range.max === undefined || range.max >= range.min, "max must not be below min");

/** Counts a brief set apart from its size, each replacing that count's bounds. */
export const SizeOverridesSchema = z
  .object(
    Object.fromEntries(SIZE_COUNTS.map((name) => [name, CountRangeSchema.optional()])) as {
      [C in SizeCount]: z.ZodOptional<typeof CountRangeSchema>;
    },
  )
  .strict();
export type SizeOverrides = z.infer<typeof SizeOverridesSchema>;

/** The bounds a case of `size` is held to, after its overrides. */
export function sizeBounds(
  size: ClueGraphSize,
  overrides: SizeOverrides = {},
): Record<SizeCount, CountRange> {
  const bounds = { ...SIZE_TABLE[size] };
  for (const name of SIZE_COUNTS) {
    const override = overrides[name];
    if (override) bounds[name] = override;
  }
  return bounds;
}
