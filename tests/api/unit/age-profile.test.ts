import { describe, expect, it } from "vitest";

import {
  allAgeProfiles,
  clampTargetAge,
  getAgeProfile,
  MAX_TARGET_AGE,
  MIN_TARGET_AGE,
  renderAgeGuidance,
} from "../../../packages/shared/src/age-profile.ts";

describe("age profile", () => {
  it("covers every age from 6 to 11", () => {
    const ages = allAgeProfiles().map((p) => p.age);
    expect(ages).toEqual([6, 7, 8, 9, 10, 11]);
  });

  it("clamps out-of-range and non-finite ages into 6–11", () => {
    expect(clampTargetAge(3)).toBe(MIN_TARGET_AGE);
    expect(clampTargetAge(99)).toBe(MAX_TARGET_AGE);
    expect(clampTargetAge(8.4)).toBe(8);
    expect(clampTargetAge(Number.NaN)).toBe(MIN_TARGET_AGE);
  });

  it("increases length and complexity targets monotonically with age", () => {
    const profiles = allAgeProfiles();
    for (let i = 1; i < profiles.length; i++) {
      const prev = profiles[i - 1];
      const cur = profiles[i];
      expect(cur.wordsPerTurn.max).toBeGreaterThanOrEqual(prev.wordsPerTurn.max);
      expect(cur.maxSentenceWords).toBeGreaterThanOrEqual(prev.maxSentenceWords);
      expect(cur.fkGradeTarget.max).toBeGreaterThanOrEqual(prev.fkGradeTarget.max);
      expect(cur.newWordAllowance).toBeGreaterThanOrEqual(prev.newWordAllowance);
    }
  });

  it("keeps Flesch–Kincaid grade targets near (age − 5)", () => {
    for (const p of allAgeProfiles()) {
      const expectedGrade = p.age - 5;
      expect(expectedGrade).toBeGreaterThanOrEqual(p.fkGradeTarget.min);
      expect(expectedGrade).toBeLessThanOrEqual(p.fkGradeTarget.max);
    }
  });

  it("renders prompt guidance that mentions the age and its limits", () => {
    const guidance = renderAgeGuidance(7);
    expect(guidance).toContain("7 years old");
    expect(guidance).toContain("40 words"); // age 7 upper word budget
    expect(guidance.toLowerCase()).toContain("sentence");
  });

  it("renders guidance for clamped ages without throwing", () => {
    expect(() => renderAgeGuidance(2)).not.toThrow();
    expect(() => renderAgeGuidance(50)).not.toThrow();
  });

  it("getAgeProfile returns the matching age record", () => {
    expect(getAgeProfile(10).age).toBe(10);
    expect(getAgeProfile(10).ukYear).toMatch(/Year/);
  });
});
