import { describe, expect, it } from "vitest";

import {
  allAgeProfiles,
  allInteractions,
  clampTargetAge,
  getAgeProfile,
  getInteraction,
  MAX_TARGET_AGE,
  MIN_TARGET_AGE,
  renderGenerationGuidance,
  renderGuidance,
  renderLengthGuidance,
  wordBudget,
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

  it("increases complexity allowances monotonically with age", () => {
    const profiles = allAgeProfiles();
    for (let i = 1; i < profiles.length; i++) {
      const prev = profiles[i - 1];
      const cur = profiles[i];
      expect(cur.softSentenceWords).toBeGreaterThanOrEqual(prev.softSentenceWords);
      expect(cur.newWordAllowance).toBeGreaterThanOrEqual(prev.newWordAllowance);
    }
  });

  it("getAgeProfile returns the matching age record", () => {
    expect(getAgeProfile(10).age).toBe(10);
    expect(getAgeProfile(10).ukYear).toMatch(/Year/);
  });
});

describe("interactions and explicit word budgets (length dial)", () => {
  it("defines all nine runtime interactions", () => {
    expect(allInteractions()).toHaveLength(9);
  });

  it("has an explicit budget for every interaction at every age", () => {
    for (const i of allInteractions()) {
      for (let age = MIN_TARGET_AGE; age <= MAX_TARGET_AGE; age++) {
        expect(typeof wordBudget(i.id, age)).toBe("number");
        expect(wordBudget(i.id, age)).toBeGreaterThan(0);
      }
    }
  });

  it("budgets rise with age for every interaction (younger = shorter)", () => {
    for (const i of allInteractions()) {
      for (let age = MIN_TARGET_AGE + 1; age <= MAX_TARGET_AGE; age++) {
        expect(wordBudget(i.id, age)).toBeGreaterThanOrEqual(wordBudget(i.id, age - 1));
      }
    }
  });

  it("the verdict is the most generous interaction; the farewell the leanest", () => {
    for (const age of [MIN_TARGET_AGE, MAX_TARGET_AGE]) {
      const budgets = allInteractions().map((i) => wordBudget(i.id, age));
      expect(wordBudget("accusation_verdict", age)).toBe(Math.max(...budgets));
      expect(wordBudget("talk_farewell", age)).toBe(Math.min(...budgets));
    }
  });

  it("clamps the age before reading a budget", () => {
    expect(wordBudget("intro", 2)).toBe(wordBudget("intro", MIN_TARGET_AGE));
    expect(wordBudget("intro", 50)).toBe(wordBudget("intro", MAX_TARGET_AGE));
  });

  it("getInteraction returns the role mapping", () => {
    expect(getInteraction("talk_round").role).toBe("talk_conversation");
  });
});

describe("guidance rendering", () => {
  it("complexity guidance threads age, sentence length and new-word allowance", () => {
    const g = renderGuidance("ambience", 6);
    expect(g).toContain("6 years old");
    expect(g.toLowerCase()).toContain("sentence");
    // age 6 allows zero new words — the allowance must surface, not sit unused.
    expect(g).toContain("Do not introduce any words");
  });

  it("surfaces a non-zero new-word allowance at older ages", () => {
    expect(renderGuidance("ambience", 11)).toContain("at most 4 words");
  });

  it("length guidance states the explicit budget and stays soft", () => {
    const g = renderLengthGuidance("intro", 11);
    expect(g).toContain("about 50 words"); // explicit budget for intro@11
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
