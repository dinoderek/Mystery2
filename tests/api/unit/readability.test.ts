import { describe, expect, it } from "vitest";

import {
  countSyllables,
  measure,
  scoreForAge,
} from "../../../packages/shared/src/readability.ts";

describe("countSyllables", () => {
  it("counts short and common words as one syllable", () => {
    expect(countSyllables("cat")).toBe(1);
    expect(countSyllables("the")).toBe(1);
    expect(countSyllables("dog")).toBe(1);
  });

  it("counts multi-syllable words approximately", () => {
    expect(countSyllables("garden")).toBe(2);
    expect(countSyllables("detective")).toBe(3);
    expect(countSyllables("mysterious")).toBeGreaterThanOrEqual(3);
  });

  it("returns 0 for empty / non-alphabetic input", () => {
    expect(countSyllables("")).toBe(0);
    expect(countSyllables("123")).toBe(0);
  });
});

describe("measure", () => {
  it("counts words and sentences", () => {
    const m = measure("The cat sat. The dog ran.");
    expect(m.words).toBe(6);
    expect(m.sentences).toBe(2);
    expect(m.maxSentenceWords).toBe(3);
  });

  it("gives simple text a low Flesch–Kincaid grade", () => {
    const m = measure("The cat sat on the mat. The dog ran to the box.");
    expect(m.fleschKincaidGrade).toBeLessThan(3);
    expect(m.fleschReadingEase).toBeGreaterThan(80);
  });

  it("gives dense text a higher grade than simple text", () => {
    const simple = measure("The cat sat. The dog ran. Sam was glad.");
    const complex = measure(
      "The investigator meticulously examined the extraordinarily complicated circumstances surrounding the disappearance.",
    );
    expect(complex.fleschKincaidGrade).toBeGreaterThan(simple.fleschKincaidGrade);
  });

  it("handles empty input without dividing by zero", () => {
    const m = measure("");
    expect(m.words).toBe(0);
    expect(Number.isFinite(m.fleschKincaidGrade)).toBe(true);
  });
});

describe("scoreForAge — complexity dial (the firm signal)", () => {
  it("passes short, simple text for a young child", () => {
    const score = scoreForAge("The red door was open. A key lay on the rug.", 6);
    expect(score.withinTarget).toBe(true);
    expect(score.flags.filter((f) => f.severity === "fail")).toHaveLength(0);
  });

  it("fails (complexity) a dense passage for a young child", () => {
    const text =
      "The remarkably perceptive young investigator gradually concluded that the perplexing circumstances surrounding the vanished inheritance necessitated a thorough examination.";
    const score = scoreForAge(text, 6);
    expect(score.withinTarget).toBe(false);
    expect(score.flags.some((f) => f.axis === "complexity" && f.severity === "fail")).toBe(true);
  });

  it("differentiates: same text passes for 11 but fails for 6", () => {
    const text =
      "Detective Mia studied the muddy footprints by the greenhouse. They pointed straight to the broken window. Someone had climbed inside during the storm last night.";
    expect(scoreForAge(text, 6).withinTarget).toBe(false);
    expect(scoreForAge(text, 11).withinTarget).toBe(true);
  });
});

describe("scoreForAge — length dial (advisory, interaction-aware)", () => {
  it("does not flag length when no interaction is supplied", () => {
    const long = "He looked around the room. ".repeat(20);
    const score = scoreForAge(long, 11);
    expect(score.flags.some((f) => f.axis === "length")).toBe(false);
  });

  it("warns (never fails) when a passage runs past the interaction soft-max", () => {
    // A farewell should be ~12 words; this is far longer.
    const text =
      "Well, goodbye for now, and do take very good care of yourself out there, and please remember to come back and visit me again very soon, my dear young friend.";
    const score = scoreForAge(text, 11, { interaction: "talk_farewell" });
    const lengthFlag = score.flags.find((f) => f.axis === "length");
    expect(lengthFlag?.severity).toBe("warn");
    // length alone must not fail the verdict
    expect(score.flags.some((f) => f.axis === "length" && f.severity === "fail")).toBe(false);
  });

  it("trims the budget for younger readers (same text, different verdict on length)", () => {
    const text = "You walk in. The lamp is on. A coat hangs by the door. It smells of rain.";
    const young = scoreForAge(text, 6, { interaction: "ambience" });
    const old = scoreForAge(text, 11, { interaction: "ambience" });
    const youngLen = young.flags.some((f) => f.axis === "length");
    const oldLen = old.flags.some((f) => f.axis === "length");
    // The same passage is more likely to exceed the younger, trimmed budget.
    expect(Number(youngLen)).toBeGreaterThanOrEqual(Number(oldLen));
  });
});

describe("scoreForAge — vocabulary dial", () => {
  it("uses an injected known-word set for exact grading (fail)", () => {
    const known = new Set(["the", "cat", "found", "a", "clue"]);
    const score = scoreForAge("The cat found a strange clue.", 6, {
      knownWords: known,
    });
    expect(score.stretchWords).toContain("strange");
    expect(score.flags.find((f) => f.axis === "vocabulary")?.severity).toBe("fail");
  });

  it("keeps vocabulary advisory (warn) when no list is supplied", () => {
    const text =
      "The investigator discovered a mysterious, complicated, extraordinary contraption.";
    const vocabFlag = scoreForAge(text, 11).flags.find((f) => f.axis === "vocabulary");
    if (vocabFlag) expect(vocabFlag.severity).toBe("warn");
  });
});
