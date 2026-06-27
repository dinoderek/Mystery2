import { describe, expect, it } from "vitest";

import {
  allAgeProfiles,
  allInteractions,
  clampTargetAge,
  effectiveLength,
  getAgeProfile,
  getInteraction,
  MAX_TARGET_AGE,
  MIN_TARGET_AGE,
  renderGenerationGuidance,
  renderGuidance,
  renderLengthGuidance,
} from "../../../packages/shared/src/age-profile.ts";

describe("age profile (complexity dial)", () => {
  it("covers every age from 6 to 11", () => {
    expect(allAgeProfiles().map((p) => p.age)).toEqual([6, 7, 8, 9, 10, 11]);
  });

  it("clamps out-of-range and non-finite ages into 6–11", () => {
    expect(clampTargetAge(3)).toBe(MIN_TARGET_AGE);
    expect(clampTargetAge(99)).toBe(MAX_TARGET_AGE);
    expect(clampTargetAge(8.4)).toBe(8);
    expect(clampTargetAge(Number.NaN)).toBe(MIN_TARGET_AGE);
  });

  it("increases complexity targets monotonically with age", () => {
    const profiles = allAgeProfiles();
    for (let i = 1; i < profiles.length; i++) {
      const prev = profiles[i - 1];
      const cur = profiles[i];
      expect(cur.softSentenceWords).toBeGreaterThanOrEqual(prev.softSentenceWords);
      expect(cur.fkGrade.softMax).toBeGreaterThanOrEqual(prev.fkGrade.softMax);
      expect(cur.newWordAllowance).toBeGreaterThanOrEqual(prev.newWordAllowance);
    }
  });

  it("keeps Flesch–Kincaid grade targets near (age − 5)", () => {
    for (const p of allAgeProfiles()) {
      const expectedGrade = p.age - 5;
      expect(expectedGrade).toBeGreaterThanOrEqual(p.fkGrade.target - 1);
      expect(expectedGrade).toBeLessThanOrEqual(p.fkGrade.softMax);
    }
  });

  it("has no minimum length anywhere in the profile", () => {
    for (const p of allAgeProfiles()) {
      expect(p).not.toHaveProperty("wordsPerTurn");
      expect(p).not.toHaveProperty("sentencesPerTurn");
    }
  });

  it("brevity bias is one-way: in (0,1], and plateaus at 1.0 for older ages", () => {
    for (const p of allAgeProfiles()) {
      expect(p.brevityBias).toBeGreaterThan(0);
      expect(p.brevityBias).toBeLessThanOrEqual(1);
    }
    expect(getAgeProfile(6).brevityBias).toBeLessThan(getAgeProfile(11).brevityBias);
    expect(getAgeProfile(10).brevityBias).toBe(1.0);
    expect(getAgeProfile(11).brevityBias).toBe(1.0);
  });
});

describe("interactions (length dial)", () => {
  it("defines all nine runtime interactions", () => {
    expect(allInteractions()).toHaveLength(9);
  });

  it("every interaction has a target no greater than its soft-max, and no minimum", () => {
    for (const i of allInteractions()) {
      expect(i.length.target).toBeLessThanOrEqual(i.length.softMax);
      expect(i.length).not.toHaveProperty("min");
    }
  });

  it("trims length down for younger readers but never pads up for older ones", () => {
    const young = effectiveLength("talk_round", 6);
    const old = effectiveLength("talk_round", 11);
    const base = getInteraction("talk_round").length;
    expect(young.target).toBeLessThan(old.target);
    expect(old.target).toBe(base.target); // age 11 uses the full natural length
    expect(old.softMax).toBe(base.softMax);
  });

  it("the verdict is the longest interaction; the farewell is the shortest", () => {
    const lengths = allInteractions().map((i) => i.length.target);
    expect(getInteraction("accusation_verdict").length.target).toBe(Math.max(...lengths));
    expect(getInteraction("talk_farewell").length.target).toBe(Math.min(...lengths));
  });
});

describe("guidance rendering", () => {
  it("complexity guidance mentions the age but not a fixed word budget", () => {
    const g = renderGuidance("ambience", 7);
    expect(g).toContain("7 years old");
    expect(g.toLowerCase()).toContain("sentence");
  });

  it("length guidance is framed as soft, not a hard cap", () => {
    const g = renderLengthGuidance("intro", 6);
    expect(g.toLowerCase()).toContain("guidance");
    expect(g.toLowerCase()).toContain("wall of text");
  });

  it("renders for clamped ages without throwing", () => {
    expect(() => renderGuidance("intro", 2)).not.toThrow();
    expect(() => renderGuidance("accusation_verdict", 50)).not.toThrow();
  });

  it("generation guidance carries the age and a brevity reminder", () => {
    const g = renderGenerationGuidance(8);
    expect(g).toContain("8 years old");
    expect(g.toLowerCase()).toContain("wall of text");
    expect(g.toLowerCase()).toContain("player-facing");
  });
});
