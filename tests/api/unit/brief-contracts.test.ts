import { describe, expect, it } from "vitest";
import { StoryBriefSchema } from "../../../packages/blueprint-generator/src/story-brief.ts";

describe("StoryBriefSchema validation", () => {
  const minimalBrief = { brief: "A stolen painting", targetAge: 10 };

  it("accepts a minimal brief with only required fields", () => {
    expect(() => StoryBriefSchema.parse(minimalBrief)).not.toThrow();
  });

  it("accepts a fully populated brief", () => {
    const full = {
      brief: "A stolen painting in a Victorian mansion",
      targetAge: 12,
      timeBudget: 15,
      titleHint: "The Vanishing Vermeer",
      oneLinerHint: "Can you find the missing masterpiece?",
      artStyle: "watercolor noir",
      mustInclude: ["hidden passage", "old diary"],
      culprits: 1,
      suspects: 3,
      witnesses: 2,
      locations: 4,
      redHerringTrails: 2,
      coverUps: true,
      eliminationComplexity: "moderate",
    };
    expect(() => StoryBriefSchema.parse(full)).not.toThrow();
  });

  it("rejects missing brief field", () => {
    expect(() => StoryBriefSchema.parse({ targetAge: 10 })).toThrow();
  });

  it("rejects empty brief string", () => {
    expect(() => StoryBriefSchema.parse({ brief: "  ", targetAge: 10 })).toThrow();
  });

  it("rejects missing targetAge", () => {
    expect(() => StoryBriefSchema.parse({ brief: "A mystery" })).toThrow();
  });

  it("rejects zero targetAge", () => {
    expect(() =>
      StoryBriefSchema.parse({ brief: "A mystery", targetAge: 0 }),
    ).toThrow();
  });

  it("rejects negative targetAge", () => {
    expect(() =>
      StoryBriefSchema.parse({ brief: "A mystery", targetAge: -5 }),
    ).toThrow();
  });

  it("rejects invalid eliminationComplexity", () => {
    expect(() =>
      StoryBriefSchema.parse({
        ...minimalBrief,
        eliminationComplexity: "extreme",
      }),
    ).toThrow();
  });

  it("accepts all valid eliminationComplexity values", () => {
    for (const value of ["simple", "moderate", "complex"]) {
      expect(() =>
        StoryBriefSchema.parse({ ...minimalBrief, eliminationComplexity: value }),
      ).not.toThrow();
    }
  });

  it("strips unknown fields", () => {
    const parsed = StoryBriefSchema.parse({
      ...minimalBrief,
      unknownField: "should be stripped",
    });
    expect(parsed).not.toHaveProperty("unknownField");
  });

  it("trims whitespace from brief", () => {
    const parsed = StoryBriefSchema.parse({
      brief: "  A mystery  ",
      targetAge: 10,
    });
    expect(parsed.brief).toBe("A mystery");
  });

  it("rejects non-integer targetAge", () => {
    expect(() =>
      StoryBriefSchema.parse({ brief: "A mystery", targetAge: 10.5 }),
    ).toThrow();
  });

  it("rejects negative suspects", () => {
    expect(() =>
      StoryBriefSchema.parse({ ...minimalBrief, suspects: -1 }),
    ).toThrow();
  });

  it("accepts zero suspects", () => {
    const parsed = StoryBriefSchema.parse({ ...minimalBrief, suspects: 0 });
    expect(parsed.suspects).toBe(0);
  });
});

describe("brief DB row ↔ StoryBrief JSON mapping", () => {
  it("snake_case DB fields map to camelCase StoryBrief fields", () => {
    // Simulates what the frontend exportAsJson would produce
    const dbRow = {
      brief: "A stolen painting",
      target_age: 10,
      time_budget: 15,
      title_hint: "The Heist",
      one_liner_hint: "Find it",
      art_style: "noir",
      must_include: ["diary"],
      culprits: 1,
      suspects: 2,
      witnesses: 1,
      locations: 3,
      red_herring_trails: 1,
      cover_ups: true,
      elimination_complexity: "simple",
    };

    const storyBrief = {
      brief: dbRow.brief,
      targetAge: dbRow.target_age,
      timeBudget: dbRow.time_budget,
      titleHint: dbRow.title_hint,
      oneLinerHint: dbRow.one_liner_hint,
      artStyle: dbRow.art_style,
      mustInclude: dbRow.must_include,
      culprits: dbRow.culprits,
      suspects: dbRow.suspects,
      witnesses: dbRow.witnesses,
      locations: dbRow.locations,
      redHerringTrails: dbRow.red_herring_trails,
      coverUps: dbRow.cover_ups,
      eliminationComplexity: dbRow.elimination_complexity,
    };

    expect(() => StoryBriefSchema.parse(storyBrief)).not.toThrow();
    const parsed = StoryBriefSchema.parse(storyBrief);
    expect(parsed.brief).toBe(dbRow.brief);
    expect(parsed.targetAge).toBe(dbRow.target_age);
    expect(parsed.timeBudget).toBe(dbRow.time_budget);
    expect(parsed.titleHint).toBe(dbRow.title_hint);
    expect(parsed.eliminationComplexity).toBe(dbRow.elimination_complexity);
  });
});
