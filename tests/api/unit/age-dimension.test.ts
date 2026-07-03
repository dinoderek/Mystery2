import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { analyze } from "../../../evaluation/checks/analyzers/age-appropriate.mjs";
import { extractPlayerFacingText } from "../../../evaluation/checks/lib/player-text.mjs";
import { schema } from "../../../evaluation/dimensions/age-appropriate.schema.ts";
import { allAgeProfiles } from "../../../packages/shared/src/age-profile.ts";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const SIMPLE = "The cat sat on the mat and looked at the door.";

function makeBlueprint(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { target_age: 10, title: "The Lost Cake", one_liner: SIMPLE },
    narrative: {
      premise: SIMPLE,
      starting_knowledge: {
        mystery_summary: SIMPLE,
        locations: [{ location_id: "loc-1", summary: SIMPLE }],
        characters: [{ character_id: "char-1", summary: SIMPLE }],
      },
    },
    world: {
      locations: [
        {
          id: "loc-1",
          description: SIMPLE,
          clues: [{ id: "clue-1", text: SIMPLE }],
          sub_locations: [
            {
              id: "sub-1",
              hint: "Narrator-only steering hint, never shown to the player.",
              clues: [{ id: "clue-2", text: SIMPLE }],
            },
          ],
        },
      ],
      characters: [
        {
          id: "char-1",
          background: "Narrator-only backstory that the model paraphrases.",
          stated_alibi: "Narrator-only alibi.",
          clues: [{ id: "clue-3", text: SIMPLE }],
        },
      ],
    },
    ...overrides,
  };
}

describe("extractPlayerFacingText", () => {
  it("collects exactly the player-facing strings", () => {
    const strings = extractPlayerFacingText(makeBlueprint());
    const paths = strings.map((s: { path: string }) => s.path);
    expect(paths).toEqual([
      "metadata.title",
      "metadata.one_liner",
      "narrative.premise",
      "narrative.starting_knowledge.mystery_summary",
      "narrative.starting_knowledge.locations[0].summary",
      "narrative.starting_knowledge.characters[0].summary",
      "world.locations[0].description",
      "world.locations[0].clues[0].text",
      "world.locations[0].sub_locations[0].clues[0].text",
      "world.characters[0].clues[0].text",
    ]);
  });

  it("excludes narrator-only material (hints, backgrounds, alibis)", () => {
    const texts = extractPlayerFacingText(makeBlueprint()).map(
      (s: { text: string }) => s.text,
    );
    expect(texts.join(" ")).not.toContain("Narrator-only");
  });

  it("skips empty and missing strings without crashing", () => {
    expect(extractPlayerFacingText({})).toEqual([]);
    expect(
      extractPlayerFacingText({ metadata: { title: "  " } }),
    ).toEqual([]);
  });
});

describe("age_appropriate analyzer", () => {
  it("passes simple text at the target age", () => {
    const result = analyze({ blueprint: makeBlueprint(), context: {} });
    expect(result.status).toBe("pass");
    expect(result.details.violations).toEqual([]);
    expect(result.details.strings_total).toBe(10);
  });

  it("fails prose far above the target age", () => {
    const blueprint = makeBlueprint({
      metadata: { target_age: 6, title: "The Lost Cake", one_liner: SIMPLE },
      narrative: {
        premise:
          "Notwithstanding considerable circumstantial ambiguity, the perpetrator systematically obliterated every piece of incriminating documentation before the investigators arrived.",
      },
    });
    const result = analyze({ blueprint, context: {} });
    expect(result.status).toBe("fail");
    expect(
      result.details.violations.map((v: { path: string }) => v.path),
    ).toContain("narrative.premise");
  });

  it("never fails strings under min_words, but still measures them", () => {
    const blueprint = makeBlueprint({
      metadata: {
        target_age: 6,
        // Complex but short: below the default 8-word floor.
        title: "Extraordinarily Perspicacious Investigations",
        one_liner: SIMPLE,
      },
    });
    const result = analyze({ blueprint, context: {} });
    expect(result.status).toBe("pass");
    const title = result.details
      .violations as Array<{ path: string }>;
    expect(title.map((v) => v.path)).not.toContain("metadata.title");
  });

  it("respects tolerance from context", () => {
    const blueprint = makeBlueprint();
    const strict = analyze({ blueprint, context: { tolerance: -6 } });
    expect(strict.status).toBe("fail");
  });

  it("fails when the blueprint has no target_age", () => {
    const result = analyze({ blueprint: { metadata: {} }, context: {} });
    expect(result.status).toBe("fail");
    expect(result.details.summary).toContain("target_age");
  });
});

describe("age_appropriate dimension wiring", () => {
  it("is registered in the standard battery with analyzer context", () => {
    const registry = JSON.parse(
      fs.readFileSync(
        path.join(REPO_ROOT, "evaluation", "dimensions", "registry.json"),
        "utf8",
      ),
    );
    const entry = registry.dimensions.find(
      (d: { id: string }) => d.id === "age_appropriate",
    );
    expect(entry).toBeDefined();
    expect(entry.context.tolerance).toBeTypeOf("number");
    expect(entry.context.min_words).toBeTypeOf("number");
  });

  it("accepts a well-formed judge verdict and rejects a malformed one", () => {
    const good = {
      target_age: 8,
      estimated_reading_age: 10,
      findings: [
        {
          path: "narrative.premise",
          quote: "an indeterminate quantity",
          kind: "vocabulary",
          why: "too advanced for age 8",
          suggestion: "some",
        },
      ],
      verdict: "fail",
      reasoning: "Vocabulary overshoots the target age.",
    };
    expect(schema.safeParse(good).success).toBe(true);
    expect(
      schema.safeParse({ ...good, findings: [{ quote: "q" }] }).success,
    ).toBe(false);
    expect(schema.safeParse({ ...good, verdict: "maybe" }).success).toBe(false);
  });
});

describe("dimension brief stays in sync with age-profile.ts", () => {
  // The judge's per-age table in age-appropriate.md is a rendered copy of
  // packages/shared/src/age-profile.ts (the single source of truth). This
  // guard fails the moment the profile changes without the brief.
  it("age-appropriate.md contains one exact table row per age profile", () => {
    const brief = fs.readFileSync(
      path.join(REPO_ROOT, "evaluation", "dimensions", "age-appropriate.md"),
      "utf8",
    );
    for (const p of allAgeProfiles()) {
      const row = `| ${p.age} | ${p.ukYear} | ${p.softSentenceWords} | ${p.newWordAllowance} | ${p.vocabGuidance} |`;
      expect(brief, `missing/stale table row for age ${p.age}`).toContain(row);
    }
  });
});
