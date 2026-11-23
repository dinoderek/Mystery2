import { z } from "zod";

const coordinate = z.number().finite().min(-200).max(200);
const vector = z.tuple([coordinate, coordinate, coordinate]);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const id = z.string().trim().min(1).max(200);
const size = z.number().finite().min(0.01).max(150);
export const MAX_SCENE_LOCATIONS = 24;

export const SceneObjectSchema = z
  .object({
    id,
    shape: z.enum(["box", "sphere", "cylinder", "cone", "torus"]),
    position: vector,
    rotation: z.tuple([
      z.number().min(-Math.PI).max(Math.PI),
      z.number().min(-Math.PI).max(Math.PI),
      z.number().min(-Math.PI).max(Math.PI),
    ]),
    scale: z.tuple([size, size, size]),
    color,
    material: z.enum(["matte", "metal", "glass", "glow"]),
    motion: z.enum(["still", "sway", "bob"]),
  })
  .strict();

export const ProceduralSceneSchema = z
  .object({
    kind: z.literal("procedural"),
    location_id: id,
    label: z.string().trim().min(1).max(600),
    sky: color,
    ambient: color,
    sun: z.object({ color, position: vector }).strict(),
    camera: z.object({ position: vector, target: vector }).strict(),
    objects: z.array(SceneObjectSchema).min(1).max(180),
  })
  .strict();

/** A recipe is a procedural scene: the one kind there is. */
export const SceneRecipeSchema = ProceduralSceneSchema;

export const SceneManifestSchema = z
  .object({
    schema_version: z.literal("scene/1"),
    blueprint_id: z.string().uuid(),
    scenes: z.array(SceneRecipeSchema).max(MAX_SCENE_LOCATIONS),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const locations = new Set<string>();
    for (const [index, scene] of manifest.scenes.entries()) {
      if (locations.has(scene.location_id))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scenes", index, "location_id"],
          message: "Duplicate location",
        });
      locations.add(scene.location_id);
      const ids = scene.objects.map((object) => object.id);
      if (new Set(ids).size !== ids.length)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scenes", index, "objects"],
          message: "Duplicate object id",
        });
      if (
        scene.camera.position.every(
          (value, axis) => value === scene.camera.target[axis],
        )
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scenes", index, "camera"],
          message: "Camera position must differ from its target",
        });
      }
    }
  });

export type SceneObject = z.infer<typeof SceneObjectSchema>;
export type ProceduralScene = z.infer<typeof ProceduralSceneSchema>;
export type SceneRecipe = z.infer<typeof SceneRecipeSchema>;
export type SceneManifest = z.infer<typeof SceneManifestSchema>;

/** Checks asset ownership and references without exposing any private blueprint fields. */
export function validateSceneManifest(
  value: unknown,
  blueprint: { id: string; world: { locations: ReadonlyArray<{ id: string }> } },
): SceneManifest {
  const manifest = SceneManifestSchema.parse(value);
  if (manifest.blueprint_id !== blueprint.id)
    throw new Error("Scene manifest belongs to another blueprint");
  const locations = new Set(
    blueprint.world.locations.map((location) => location.id),
  );
  for (const scene of manifest.scenes) {
    if (!locations.has(scene.location_id))
      throw new Error(`Unknown scene location: ${scene.location_id}`);
  }
  return manifest;
}
