import { describe, expect, it } from "vitest";

import {
  countSyllables,
  expectedGradeForAge,
  fleschKincaidGrade,
  judge,
} from "../../../evaluation/runtime/lib/judges/flesch.mjs";

describe("countSyllables", () => {
  it("counts short words as one syllable", () => {
    expect(countSyllables("the")).toBe(1);
    expect(countSyllables("cat")).toBe(1);
    expect(countSyllables("a")).toBe(1);
  });

  it("counts multi-syllable words", () => {
    expect(countSyllables("apple")).toBe(2);
    expect(countSyllables("banana")).toBe(3);
    expect(countSyllables("table")).toBe(2); // consonant + -le
  });

  it("handles silent trailing e", () => {
    expect(countSyllables("cake")).toBe(1);
    expect(countSyllables("nice")).toBe(1);
  });

  it("never returns zero for a real word", () => {
    expect(countSyllables("rhythm")).toBeGreaterThanOrEqual(1);
  });
});

describe("expectedGradeForAge", () => {
  it("maps age to US grade with a kindergarten floor", () => {
    expect(expectedGradeForAge(10)).toBe(5);
    expect(expectedGradeForAge(5)).toBe(0);
    expect(expectedGradeForAge(3)).toBe(0); // never negative
  });
});

describe("fleschKincaidGrade", () => {
  it("scores simple short sentences at a low grade", () => {
    const easy = "The cat sat on the mat. The dog ran fast.";
    const grade = fleschKincaidGrade(easy);
    expect(grade).not.toBeNull();
    expect(grade as number).toBeLessThan(5);
  });

  it("scores long, polysyllabic prose at a higher grade than simple prose", () => {
    const easy = "The cat sat. The dog ran. We had fun.";
    const hard =
      "The investigation subsequently revealed numerous contradictory testimonies that " +
      "fundamentally undermined the prosecution's reconstruction of the circumstances.";
    expect((fleschKincaidGrade(hard) as number)).toBeGreaterThan(
      fleschKincaidGrade(easy) as number,
    );
  });

  it("returns null for empty text", () => {
    expect(fleschKincaidGrade("")).toBeNull();
  });
});

describe("judge", () => {
  function interaction(text: string, targetAge = 10) {
    return {
      run_id: "test",
      case_id: "test",
      backend: "endpoint",
      model: "mock",
      target_age: targetAge,
      action: { type: "ask" },
      response: {
        action: "ask",
        narration_text: text,
        narration_parts: [{ text, speaker: { kind: "character" } }],
      },
    };
  }

  it("passes when narration is at or below the target reading level", () => {
    const result = judge(interaction("The cat sat on the mat. The dog ran fast and had fun."));
    expect(result.status).toBe("pass");
    expect(result.details.target_age).toBe(10);
    expect(result.parts).toHaveLength(1);
  });

  it("fails when narration reads above the target age + tolerance", () => {
    const hard =
      "The investigation subsequently revealed numerous contradictory testimonies that " +
      "fundamentally undermined the prosecution's elaborate reconstruction of the circumstances " +
      "surrounding the unfortunate disappearance.";
    const result = judge(interaction(hard, 8));
    expect(result.status).toBe("fail");
    expect(result.score as number).toBeGreaterThan(result.details.threshold as number);
  });

  it("errors when the response has no narration text", () => {
    const result = judge({ target_age: 10, response: { narration_text: "" } } as never);
    expect(result.status).toBe("error");
  });

  it("errors when no target_age is available", () => {
    const result = judge({ response: { narration_text: "Hi there friend." } } as never);
    expect(result.status).toBe("error");
  });

  it("respects an explicit tolerance override", () => {
    const text = "The quiet detective examined the broken window carefully before speaking softly.";
    const strict = judge(interaction(text, 6));
    // With a generous tolerance the same text should pass.
    const generous = judge(interaction(text, 6), { config: { tolerance: 20 } });
    expect(generous.status).toBe("pass");
    expect(["pass", "fail"]).toContain(strict.status);
  });
});
