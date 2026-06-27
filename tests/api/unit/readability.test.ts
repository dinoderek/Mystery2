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

describe("scoreForAge", () => {
  it("passes short, simple text for a young child", () => {
    const score = scoreForAge("The red door was open. A key lay on the rug.", 6);
    expect(score.withinTarget).toBe(true);
    expect(score.flags.filter((f) => f.severity === "fail")).toHaveLength(0);
  });

  it("fails a long, complex passage for a young child", () => {
    const text =
      "The remarkably perceptive young investigator, having meticulously surveyed the extraordinarily disordered drawing room, gradually concluded that the perplexing circumstances surrounding the vanished inheritance necessitated a considerably more thorough and systematic examination of every conceivable hiding place throughout the cavernous mansion.";
    const score = scoreForAge(text, 6);
    expect(score.withinTarget).toBe(false);
    const axes = score.flags.map((f) => f.axis);
    expect(axes).toContain("length");
    expect(axes).toContain("sentence_length");
    expect(axes).toContain("complexity");
  });

  it("differentiates: same text can pass for 11 but fail for 6", () => {
    const text =
      "Detective Mia studied the muddy footprints by the greenhouse. They pointed straight to the broken window. Someone had climbed inside during the storm last night.";
    const young = scoreForAge(text, 6);
    const older = scoreForAge(text, 11);
    expect(young.withinTarget).toBe(false);
    expect(older.withinTarget).toBe(true);
  });

  it("uses an injected known-word set for exact vocabulary grading", () => {
    const known = new Set(["the", "cat", "found", "a", "clue"]);
    const score = scoreForAge("The cat found a strange clue.", 6, {
      knownWords: known,
    });
    expect(score.stretchWords).toContain("strange");
    const vocabFlag = score.flags.find((f) => f.axis === "vocabulary");
    expect(vocabFlag?.severity).toBe("fail"); // exact mode escalates to fail
  });

  it("keeps vocabulary advisory (warn) when no list is supplied", () => {
    const text =
      "The investigator discovered a mysterious, complicated, extraordinary contraption.";
    const score = scoreForAge(text, 11, {});
    const vocabFlag = score.flags.find((f) => f.axis === "vocabulary");
    if (vocabFlag) expect(vocabFlag.severity).toBe("warn");
  });
});
