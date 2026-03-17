import { describe, expect, it } from "vitest";
import { BlueprintSchema } from "../../../supabase/functions/_shared/blueprints/blueprint-schema.ts";
import { VerificationReportSchema } from "../../../supabase/functions/_shared/blueprints/verification-report.ts";
import { AIJudgeReportSchema } from "../../../supabase/functions/_shared/blueprints/ai-judge-report.ts";

function createValidBlueprint() {
  return {
    id: "123e4567-e89b-12d3-a456-426614174000",
    metadata: {
      title: "Mock Blueprint",
      one_liner: "A simple test mystery.",
      target_age: 10,
      time_budget: 10,
      visual: {
        style: "storybook watercolor",
        mood: "cozy and curious",
        palette: "warm reds and honey browns",
        lighting_or_atmosphere: "soft afternoon light",
        cover: {
          summary: "A cozy kitchen mystery with flour, cookies, and curious suspects.",
          visual_anchors: ["cookie jar", "warm kitchen", "detective notebook"],
        },
      },
    },
    narrative: {
      premise: "Someone stole the cookies.",
      starting_knowledge: ["The cookie jar was open."],
    },
    world: {
      starting_location_key: "kitchen",
      locations: [
        {
          location_key: "kitchen",
          name: "Kitchen",
          description: "A messy kitchen.",
          search_context: ["Fresh crumbs sit near the cookie jar."],
          visual: {
            summary: "A flour-dusted family kitchen with a cookie jar on the counter.",
            visual_anchors: ["cookie jar", "mixing bowl", "sunlit counter"],
          },
        },
        {
          location_key: "living-room",
          name: "Living Room",
          description: "A cozy living room.",
          search_context: ["A television hums in the corner."],
          visual: {
            summary: "A soft sofa, television, and tidy rug.",
            visual_anchors: ["sofa", "television", "plaid blanket"],
          },
        },
        {
          location_key: "hallway",
          name: "Hallway",
          description: "A narrow hallway with family photos.",
          search_context: ["A shoe rack stands by the door."],
          visual: {
            summary: "A bright hallway with framed photos and a shoe rack.",
            visual_anchors: ["family photos", "shoe rack", "front door"],
          },
        },
      ],
      characters: [
        {
          character_key: "alice",
          first_name: "Alice",
          last_name: "Smith",
          location_key: "kitchen",
          roleplay: {
            persona: "A nervous baker who talks quickly when worried.",
            background: "She often bakes for the family.",
            attitude: "Guarded but polite.",
          },
          private_alibi: "I was reading.",
          private_motive: "She skipped lunch and felt hungry.",
          visual: {
            summary: "A baker with red hair and a flour-dusted apron.",
            visual_anchors: ["red hair", "apron", "nervous smile"],
          },
        },
        {
          character_key: "bob",
          first_name: "Bob",
          last_name: "Jones",
          location_key: "living-room",
          roleplay: {
            persona: "A calm guest who answers carefully.",
            background: "He is visiting for the afternoon.",
            attitude: "Helpful and patient.",
          },
          private_alibi: "I was watching television.",
          private_motive: null,
          visual: {
            summary: "A guest with glasses and a tidy cardigan.",
            visual_anchors: ["glasses", "cardigan", "remote control"],
          },
        },
        {
          character_key: "carol",
          first_name: "Carol",
          last_name: "Brown",
          location_key: "hallway",
          roleplay: {
            persona: "An organized neighbor with sharp eyes.",
            background: "She dropped by to return a book.",
            attitude: "Curious and observant.",
          },
          private_alibi: "I was by the front door with the shoe rack.",
          private_motive: null,
          visual: {
            summary: "A neat neighbor carrying a library book.",
            visual_anchors: ["library book", "blue coat", "watchful eyes"],
          },
        },
      ],
    },
    evidence: [
      {
        evidence_key: "open-cookie-jar",
        player_text: "The cookie jar lid is still tipped sideways.",
        fact_summary: "The thief left the cookie jar open in a hurry.",
        essential: true,
        related_location_keys: ["kitchen"],
        related_character_keys: ["alice"],
        acquisition_paths: [{ surface: "start", location_key: "kitchen" }],
      },
      {
        evidence_key: "crumbs-on-floor",
        player_text: "Fresh cookie crumbs sparkle on the kitchen floor.",
        fact_summary: "Someone ate cookies in the kitchen recently.",
        essential: true,
        related_location_keys: ["kitchen"],
        related_character_keys: ["alice"],
        acquisition_paths: [{ surface: "search", location_key: "kitchen" }],
      },
      {
        evidence_key: "alice-hungry",
        player_text: "Alice admits she skipped lunch and felt very hungry.",
        fact_summary: "Alice had a clear motive tied to hunger.",
        essential: true,
        related_location_keys: ["kitchen"],
        related_character_keys: ["alice"],
        acquisition_paths: [
          { surface: "talk", location_key: "kitchen", character_key: "alice" },
        ],
      },
    ],
    ground_truth: {
      culprit_character_key: "alice",
      what_happened: "Alice ate the cookies while nobody was looking.",
      why_it_happened: "She was hungry after skipping lunch.",
      explanation:
        "Alice stayed in the kitchen, ate the cookies, and failed to hide the open jar and crumbs.",
      suspect_truths: [
        {
          character_key: "alice",
          actual_activity: "She ate the cookies in the kitchen.",
          stated_alibi: "I was reading.",
          motive: "She was hungry after skipping lunch.",
          contradiction_evidence_keys: ["open-cookie-jar", "crumbs-on-floor"],
        },
        {
          character_key: "bob",
          actual_activity: "He watched television in the living room.",
          stated_alibi: "I was watching television.",
          motive: null,
          contradiction_evidence_keys: [],
        },
        {
          character_key: "carol",
          actual_activity: "She waited by the front door to return a book.",
          stated_alibi: "I was by the front door with the shoe rack.",
          motive: null,
          contradiction_evidence_keys: [],
        },
      ],
      timeline: [
        {
          timeline_entry_key: "alice-enters-kitchen",
          order: 0,
          summary: "Alice stayed behind in the kitchen after lunch.",
          location_key: "kitchen",
          character_key: "alice",
        },
        {
          timeline_entry_key: "alice-eats-cookies",
          order: 1,
          summary: "Alice opened the jar and ate several cookies.",
          location_key: "kitchen",
          character_key: "alice",
        },
      ],
    },
  };
}

describe("Blueprint V2 schema", () => {
  it("accepts valid Blueprint V2 payloads", () => {
    expect(() => BlueprintSchema.parse(createValidBlueprint())).not.toThrow();
  });

  it("rejects duplicate stable keys", () => {
    const invalid = createValidBlueprint();
    invalid.world.locations[1].location_key = "kitchen";

    expect(() => BlueprintSchema.parse(invalid)).toThrow("Duplicate location_key");
  });

  it("rejects broken cross references", () => {
    const invalid = createValidBlueprint();
    invalid.evidence[0].acquisition_paths[0].location_key = "attic";

    expect(() => BlueprintSchema.parse(invalid)).toThrow("unknown location_key");
  });
});

describe("verification report schema", () => {
  it("accepts structured deterministic verification reports", () => {
    expect(() =>
      VerificationReportSchema.parse({
        stage: "verify",
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
        blueprint_path: "blueprints/mock.json",
        run_id: "20260317T120000Z",
        status: "warn",
        blocking_findings: [],
        warning_findings: [{ rule_id: "warn.example", message: "Example warning" }],
        info_findings: [],
        computed_metrics: {
          location_count: 3,
          character_count: 3,
          evidence_count: 3,
          essential_evidence_count: 3,
          required_actions: 2,
          action_budget_limit: 7,
        },
      })
    ).not.toThrow();
  });
});

describe("AI judge report schema", () => {
  it("accepts rubric-based judge artifacts", () => {
    expect(() =>
      AIJudgeReportSchema.parse({
        stage: "judge",
        judge_version: "v1",
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
        dimension_scores: {
          coherence_fairness: 4,
          spoiler_safety: 5,
          age_fit: 4,
          image_readiness: 5,
        },
        blocking_findings: [],
        advisory_findings: [{ code: "tighten-motive", message: "Motive could be sharper." }],
        promotion_recommendation: "revise",
        citations: [{ path: "evidence[0]", note: "Strong opening clue." }],
      })
    ).not.toThrow();
  });
});
