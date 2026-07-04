// Deterministic analyzer for the `age_appropriate` dimension.
//
// Screens every player-facing string in the blueprint with the Flesch–Kincaid
// grade level and fails on the objective, code-decidable fault: prose that
// measures clearly above the reading grade implied by metadata.target_age
// (grade ≈ age − 5, plus a tolerance). FK is unreliable on fragments, so
// strings under `min_words` are measured and reported but never failed. The
// subjective calls — unfamiliar vocabulary, figurative language, clarity —
// are left to the judge half of the dimension.
//
// Context (from evaluation/dimensions/registry.json):
//   tolerance — grade levels of slack above the target (default 2)
//   min_words — minimum words before a string can fail on FK (default 8)

import {
  expectedGradeForAge,
  fleschKincaidGrade,
  splitWords,
} from "../../lib/readability.mjs";
import { extractPlayerFacingText } from "../lib/player-text.mjs";

const DEFAULT_TOLERANCE = 2;
const DEFAULT_MIN_WORDS = 8;

export function analyze({ blueprint, context }) {
  const targetAge = blueprint?.metadata?.target_age;
  if (!Number.isFinite(targetAge)) {
    return {
      status: "fail",
      details: {
        summary: "blueprint has no numeric metadata.target_age to judge against",
      },
    };
  }

  const tolerance = Number.isFinite(context?.tolerance)
    ? context.tolerance
    : DEFAULT_TOLERANCE;
  const minWords = Number.isFinite(context?.min_words)
    ? context.min_words
    : DEFAULT_MIN_WORDS;
  const expectedGrade = expectedGradeForAge(targetAge);
  const threshold = expectedGrade + tolerance;

  const strings = extractPlayerFacingText(blueprint);
  if (strings.length === 0) {
    // Nothing to check is a failure, not a pass: an empty or malformed
    // blueprint must not be reported as passing the age-appropriate screen.
    return {
      status: "fail",
      details: {
        target_age: targetAge,
        strings_total: 0,
        summary: "no player-facing text extracted from the blueprint — nothing to check",
      },
    };
  }
  const measured = strings.map((s) => {
    const words = splitWords(s.text).length;
    const grade = fleschKincaidGrade(s.text);
    return {
      path: s.path,
      kind: s.kind,
      words,
      grade,
      over_threshold: grade !== null && grade > threshold,
      scored: words >= minWords,
      preview: s.text.slice(0, 120),
    };
  });

  const violations = measured.filter((m) => m.scored && m.over_threshold);
  const worst = measured
    .filter((m) => m.grade !== null)
    .reduce((max, m) => (max === null || m.grade > max.grade ? m : max), null);

  return {
    status: violations.length === 0 ? "pass" : "fail",
    details: {
      target_age: targetAge,
      expected_grade: expectedGrade,
      tolerance,
      threshold,
      min_words: minWords,
      strings_total: measured.length,
      strings_scored: measured.filter((m) => m.scored).length,
      violations,
      worst_grade: worst?.grade ?? null,
      worst_path: worst?.path ?? null,
      summary:
        violations.length === 0
          ? `all ${measured.length} player-facing strings within FK grade ${threshold} (age ${targetAge})`
          : `${violations.length} player-facing string(s) above FK grade ${threshold} (age ${targetAge})`,
    },
  };
}
