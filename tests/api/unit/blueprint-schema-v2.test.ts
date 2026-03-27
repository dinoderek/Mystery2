import { describe, expect, it } from "vitest";

import { BlueprintV2Schema } from "../../../packages/shared/src/blueprint-schema-v2.ts";
import { validBlueprintV2 } from "./fixtures/blueprint-v2.fixture.ts";

describe("Blueprint V2 schema", () => {
  it("accepts a valid authored Blueprint V2", () => {
    expect(() => BlueprintV2Schema.parse(validBlueprintV2)).not.toThrow();
  });

  it("accepts location clues that are not referenced by any path", () => {
    const withUnlinked = {
      ...validBlueprintV2,
      world: {
        ...validBlueprintV2.world,
        locations: validBlueprintV2.world.locations.map((location, index) =>
          index === 0
            ? {
                ...location,
                clues: [
                  ...location.clues,
                  {
                    id: "loc-unlinked",
                    text: "An extra clue with no path.",
                    role: "supporting_evidence" as const,
                  },
                ],
              }
            : location,
        ),
      },
    };

    expect(() => BlueprintV2Schema.parse(withUnlinked)).not.toThrow();
  });

  it("rejects reasoning paths that reference missing clue ids", () => {
    const broken = {
      ...validBlueprintV2,
      solution_paths: [
        {
          ...validBlueprintV2.solution_paths[0],
          location_clue_ids: ["loc-missing"],
        },
      ],
    };

    expect(() => BlueprintV2Schema.parse(broken)).toThrow(
      /Unknown location clue id/,
    );
  });

  it("rejects cover_image.location_ids referencing a non-existent location", () => {
    const broken = {
      ...validBlueprintV2,
      cover_image: {
        description: "A test cover.",
        location_ids: ["non-existent-loc"],
        character_ids: [],
      },
    };

    expect(() => BlueprintV2Schema.parse(broken)).toThrow(
      /cover_image\.location_ids references unknown location id/,
    );
  });

  it("rejects cover_image.character_ids referencing a non-existent character", () => {
    const broken = {
      ...validBlueprintV2,
      cover_image: {
        description: "A test cover.",
        location_ids: [],
        character_ids: ["non-existent-char"],
      },
    };

    expect(() => BlueprintV2Schema.parse(broken)).toThrow(
      /cover_image\.character_ids references unknown character id/,
    );
  });

  it("accepts cover_image with empty location_ids and character_ids", () => {
    const minimal = {
      ...validBlueprintV2,
      cover_image: {
        description: "An abstract atmospheric cover.",
        location_ids: [],
        character_ids: [],
      },
    };

    expect(() => BlueprintV2Schema.parse(minimal)).not.toThrow();
  });

  describe("character agendas", () => {
    function withAgendas(
      characterId: string,
      agendas: Record<string, unknown>[],
    ) {
      return {
        ...validBlueprintV2,
        world: {
          ...validBlueprintV2.world,
          characters: validBlueprintV2.world.characters.map((c) =>
            c.id === characterId ? { ...c, agendas } : c,
          ),
        },
      };
    }

    it("accepts a valid self_protect agenda", () => {
      const bp = withAgendas("alice", [
        {
          type: "self_protect",
          strategy: "maintain_false_alibi",
          priority: "high",
          details: "Alice insists she was washing dishes the whole time.",
        },
      ]);
      expect(() => BlueprintV2Schema.parse(bp)).not.toThrow();
    });

    it("accepts a valid protect_other agenda", () => {
      const bp = withAgendas("bob", [
        {
          type: "protect_other",
          strategy: "deflect_questions",
          priority: "medium",
          details: "Bob avoids talking about Alice's movements.",
          target_character_id: "alice",
        },
      ]);
      expect(() => BlueprintV2Schema.parse(bp)).not.toThrow();
    });

    it("rejects protect_other agenda without target_character_id", () => {
      const bp = withAgendas("bob", [
        {
          type: "protect_other",
          strategy: "deflect_questions",
          priority: "medium",
          details: "Bob avoids talking about someone.",
        },
      ]);
      expect(() => BlueprintV2Schema.parse(bp)).toThrow(
        /requires target_character_id/,
      );
    });

    it("rejects agenda with target_character_id referencing nonexistent character", () => {
      const bp = withAgendas("bob", [
        {
          type: "implicate_other",
          strategy: "plant_doubt",
          priority: "low",
          details: "Bob steers suspicion toward someone.",
          target_character_id: "nonexistent",
        },
      ]);
      expect(() => BlueprintV2Schema.parse(bp)).toThrow(
        /must reference an existing character/,
      );
    });

    it("rejects agenda with target_character_id referencing self", () => {
      const bp = withAgendas("bob", [
        {
          type: "implicate_other",
          strategy: "plant_doubt",
          priority: "low",
          details: "Bob steers suspicion toward himself.",
          target_character_id: "bob",
        },
      ]);
      expect(() => BlueprintV2Schema.parse(bp)).toThrow(
        /must not reference the character itself/,
      );
    });

    it("rejects conditional_reveal agenda without gated_clue_id", () => {
      const bp = withAgendas("alice", [
        {
          type: "conditional_reveal",
          strategy: "withhold_key_info",
          priority: "medium",
          details: "Alice won't share unless pressed.",
          condition: "pressure",
        },
      ]);
      expect(() => BlueprintV2Schema.parse(bp)).toThrow(
        /requires gated_clue_id/,
      );
    });

    it("rejects conditional_reveal agenda without condition", () => {
      const bp = withAgendas("alice", [
        {
          type: "conditional_reveal",
          strategy: "withhold_key_info",
          priority: "medium",
          details: "Alice won't share unless something happens.",
          gated_clue_id: "char-alice-bag",
        },
      ]);
      expect(() => BlueprintV2Schema.parse(bp)).toThrow(
        /requires condition/,
      );
    });

    it("rejects conditional_reveal with gated_clue_id not in character's clues", () => {
      const bp = withAgendas("alice", [
        {
          type: "conditional_reveal",
          strategy: "withhold_key_info",
          priority: "medium",
          details: "Alice won't share.",
          gated_clue_id: "char-bob-saw-bag",
          condition: "pressure",
        },
      ]);
      expect(() => BlueprintV2Schema.parse(bp)).toThrow(
        /must reference a clue in this character's clues array/,
      );
    });

    it("accepts valid conditional_reveal with confronted_with_evidence", () => {
      const bp = withAgendas("alice", [
        {
          type: "conditional_reveal",
          strategy: "withhold_key_info",
          priority: "medium",
          details: "Alice won't share unless shown evidence.",
          gated_clue_id: "char-alice-bag",
          condition: "confronted_with_evidence",
          yields_to_clue_ids: ["loc-crumbs"],
        },
      ]);
      expect(() => BlueprintV2Schema.parse(bp)).not.toThrow();
    });

    it("rejects confronted_with_evidence without yields_to_clue_ids", () => {
      const bp = withAgendas("alice", [
        {
          type: "conditional_reveal",
          strategy: "withhold_key_info",
          priority: "medium",
          details: "Alice won't share.",
          gated_clue_id: "char-alice-bag",
          condition: "confronted_with_evidence",
        },
      ]);
      expect(() => BlueprintV2Schema.parse(bp)).toThrow(
        /requires non-empty yields_to_clue_ids/,
      );
    });

    it("rejects yields_to_clue_ids referencing nonexistent clue", () => {
      const bp = withAgendas("alice", [
        {
          type: "conditional_reveal",
          strategy: "withhold_key_info",
          priority: "medium",
          details: "Alice won't share.",
          gated_clue_id: "char-alice-bag",
          condition: "confronted_with_evidence",
          yields_to_clue_ids: ["nonexistent-clue"],
        },
      ]);
      expect(() => BlueprintV2Schema.parse(bp)).toThrow(
        /yields_to_clue_ids references unknown clue id/,
      );
    });

    it("rejects yields_to_clue_ids referencing own character's clue", () => {
      const bp = withAgendas("alice", [
        {
          type: "conditional_reveal",
          strategy: "withhold_key_info",
          priority: "medium",
          details: "Alice won't share.",
          gated_clue_id: "char-alice-bag",
          condition: "confronted_with_evidence",
          yields_to_clue_ids: ["char-alice-bag"],
        },
      ]);
      expect(() => BlueprintV2Schema.parse(bp)).toThrow(
        /must not reference clues from the same character/,
      );
    });
  });

  describe("cross-character knowledge clues", () => {
    function withBobClue(clue: Record<string, unknown>) {
      return {
        ...validBlueprintV2,
        world: {
          ...validBlueprintV2.world,
          characters: validBlueprintV2.world.characters.map((c) =>
            c.id === "bob"
              ? { ...c, clues: [...c.clues, clue] }
              : c,
          ),
        },
        solution_paths: [
          {
            ...validBlueprintV2.solution_paths[0],
            character_clue_ids: [
              ...Array.from(validBlueprintV2.solution_paths[0].character_clue_ids),
              String(clue.id),
            ],
          },
        ],
      };
    }

    it("accepts alibi_knowledge clue with about_character_id", () => {
      const bp = withBobClue({
        id: "char-bob-alibi-knowledge",
        text: "Bob saw Alice near the oven at 10:05.",
        role: "alibi_knowledge",
        about_character_id: "alice",
      });
      expect(() => BlueprintV2Schema.parse(bp)).not.toThrow();
    });

    it("rejects alibi_knowledge clue without about_character_id", () => {
      const bp = withBobClue({
        id: "char-bob-alibi-bad",
        text: "Bob saw someone near the oven.",
        role: "alibi_knowledge",
      });
      expect(() => BlueprintV2Schema.parse(bp)).toThrow(
        /must have about_character_id/,
      );
    });

    it("rejects location_hint clue without hint_location_id", () => {
      const bp = withBobClue({
        id: "char-bob-loc-hint-bad",
        text: "Bob says to check somewhere.",
        role: "location_hint",
      });
      expect(() => BlueprintV2Schema.parse(bp)).toThrow(
        /must have hint_location_id/,
      );
    });

    it("rejects about_character_id referencing nonexistent character", () => {
      const bp = withBobClue({
        id: "char-bob-witness-bad",
        text: "Bob saw a ghost.",
        role: "witness_testimony",
        about_character_id: "ghost",
      });
      expect(() => BlueprintV2Schema.parse(bp)).toThrow(
        /must reference an existing character/,
      );
    });

    it("rejects hint_location_id referencing nonexistent location", () => {
      const bp = withBobClue({
        id: "char-bob-hint-bad",
        text: "Bob says to check the basement.",
        role: "location_hint",
        hint_location_id: "basement",
      });
      expect(() => BlueprintV2Schema.parse(bp)).toThrow(
        /must reference an existing location/,
      );
    });
  });
});
