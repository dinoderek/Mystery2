import { zodToJsonSchema } from "zod-to-json-schema";
import type { BlueprintV2 } from "../../shared/src/blueprint-schema-v2.ts";
import { ProceduralSceneSchema } from "../../shared/src/scene-schema.ts";

const SYSTEM = `Create a beautiful, child-friendly, fixed-camera 3D storybook diorama from the public setting supplied as JSON.
Return only a JSON procedural scene matching the supplied schema. This is scenery, not a puzzle-solving interface.
Use only the location description and named searchable areas. Never invent evidence, missing objects, readable writing, suspects, answers, or hidden contents. Show closed containers closed. No people: conversations use existing portraits.
Compose 25–90 simple shapes into recognizable architecture, furniture, trees, water, and atmospheric details. Match the supplied palette, mood, and lighting. Use depth and a strong focal point; avoid a sparse scattering of unrelated primitives.
All shapes are centered: box has unit sides; sphere has radius .5; cylinder and cone have radius .5 and height 1; torus has radius .5 and tube radius .06, facing +Z. Scale gives dimensions in world units; rotation is XYZ Euler radians. Put floors just below y=0. Keep the composition within 25 units and frame every important feature with a camera aimed at it. No walls between camera and subject.
Materials: matte, metal, translucent glass, or self-lit glow. Motions are still, gentle sway, or gentle vertical bob. Use bob for boats and water details, sway for leaves and flags; keep architecture still.
Use the supplied location id unchanged. The label must repeat the public location description. Every object needs a unique, descriptive id. Never output code, URLs, textures, models, or fields outside the schema.`;

/** Explicit projection: no clue text, hints, character secrets, or solution data reaches the model. */
export function buildSceneGenerationInput(
  blueprint: BlueprintV2,
  locationId: string,
) {
  const location = blueprint.world.locations.find(
    (item) => item.id === locationId,
  );
  if (!location) throw new Error(`Unknown scene location: ${locationId}`);
  const direction = blueprint.metadata.visual_direction;
  return {
    systemPrompt: SYSTEM,
    userMessage: JSON.stringify({
      visual_direction: direction
        ? {
            art_style: direction.art_style,
            color_palette: direction.color_palette,
            mood: direction.mood,
            lighting: direction.lighting,
            texture: direction.texture,
          }
        : {
            art_style: blueprint.metadata.art_style ?? "warm storybook diorama",
          },
      location: {
        id: location.id,
        name: location.name,
        description: location.description,
        searchable_areas: location.sub_locations.map((area) => area.name),
      },
    }),
    answerSchema: zodToJsonSchema(ProceduralSceneSchema, {
      $refStrategy: "none",
    }) as Record<string, unknown>,
  };
}
