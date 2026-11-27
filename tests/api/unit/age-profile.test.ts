import { describe, expect, it } from "vitest";

import {
  allAgeProfiles,
  allLines,
  allInteractions,
  lineBudget,
  clampReadingAge,
  getAgeProfile,
  getInteraction,
  MAX_READING_AGE,
  MIN_READING_AGE,
  renderGuidance,
  renderLengthGuidance,
  renderOutcomeLengthGuidance,
  wordBudget,
} from "../../../packages/shared/src/age-profile.ts";

describe("age profile (complexity dial)", () => {
  it("covers every age from 6 to 11", () => {
    expect(allAgeProfiles().map((p) => p.age)).toEqual([6, 7, 8, 9, 10, 11]);
  });

  it("clamps out-of-range and non-finite ages into 6–11", () => {
    expect(clampReadingAge(3)).toBe(MIN_READING_AGE);
    expect(clampReadingAge(99)).toBe(MAX_READING_AGE);
    expect(clampReadingAge(8.4)).toBe(8);
    expect(clampReadingAge(Number.NaN)).toBe(MIN_READING_AGE);
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
      for (let age = MIN_READING_AGE; age <= MAX_READING_AGE; age++) {
        expect(typeof wordBudget(i.id, age)).toBe("number");
        expect(wordBudget(i.id, age)).toBeGreaterThan(0);
      }
    }
  });

  it("budgets rise with age for every interaction (younger = shorter)", () => {
    for (const i of allInteractions()) {
      for (let age = MIN_READING_AGE + 1; age <= MAX_READING_AGE; age++) {
        expect(wordBudget(i.id, age)).toBeGreaterThanOrEqual(wordBudget(i.id, age - 1));
      }
    }
  });

  it("the verdict and the arrival are the most generous interactions; the farewell the leanest", () => {
    for (let age = MIN_READING_AGE; age <= MAX_READING_AGE; age++) {
      const budgets = allInteractions().map((i) => wordBudget(i.id, age));
      expect(
        Math.max(wordBudget("accusation_verdict", age), wordBudget("ambience", age)),
      ).toBe(Math.max(...budgets));
      expect(wordBudget("talk_farewell", age)).toBe(Math.min(...budgets));
    }
  });

  it("gives arrival room for the place, its searchable areas and whoever is there", () => {
    const byAge = [6, 7, 8, 9, 10, 11].map((age) => wordBudget("ambience", age));
    expect(byAge).toEqual([30, 36, 44, 52, 60, 70]);
    expect(renderLengthGuidance("ambience", 7)).toContain("about 36 words");
  });

  it("clamps the age before reading a budget", () => {
    expect(wordBudget("intro", 2)).toBe(wordBudget("intro", MIN_READING_AGE));
    expect(wordBudget("intro", 50)).toBe(wordBudget("intro", MAX_READING_AGE));
  });

  it("getInteraction returns the role mapping", () => {
    expect(getInteraction("talk_round").role).toBe("graph_talk");
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

  it("outcome length guidance names both budgets and their conditions", () => {
    const g = renderOutcomeLengthGuidance(10, [
      { id: "search_find", when: "if you reveal a clue" },
      { id: "search_empty", when: "if you reveal nothing" },
    ]);
    expect(g).toContain("if you reveal a clue, aim for about 35 words");
    expect(g).toContain("if you reveal nothing, aim for about 20 words");
    expect(g.toLowerCase()).toContain("not a hard limit");
  });
});

describe("line budgets (menu and notebook lines)", () => {
  it("covers every line at every age, rising with age", () => {
    for (const id of allLines()) {
      for (let age = MIN_READING_AGE; age <= MAX_READING_AGE; age++) {
        expect(lineBudget(id, age)).toBeGreaterThan(0);
        if (age > MIN_READING_AGE) expect(lineBudget(id, age)).toBeGreaterThanOrEqual(lineBudget(id, age - 1));
      }
    }
  });

  it("clamps the age before reading a budget", () => {
    expect(lineBudget("menu_line", 2)).toBe(lineBudget("menu_line", MIN_READING_AGE));
    expect(lineBudget("menu_line", 50)).toBe(lineBudget("menu_line", MAX_READING_AGE));
  });
});
