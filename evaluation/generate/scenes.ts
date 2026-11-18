import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { buildSceneGenerationInput } from "../../packages/blueprint-generator/src/scene-prompt.ts";
import { BlueprintV2Schema } from "../../packages/shared/src/blueprint-schema-v2.ts";
import {
  ProceduralSceneSchema,
  MAX_SCENE_LOCATIONS,
  validateSceneManifest,
  type SceneManifest,
} from "../../packages/shared/src/scene-schema.ts";
import { getBlueprintsDir } from "../../scripts/local-config.mjs";
import { readJsonFile } from "../blueprint/inputs.ts";
import { formatHelp, parseCommandArgs } from "../core/args.ts";
import { loadConfig, resolveBinding } from "../core/config.ts";
import type { EvalCommand } from "../core/dispatch.ts";
import { createRunFolder, resolveOutputRoot } from "../core/run-folder.ts";
import {
  RESULT_SCHEMA_VERSION,
  summarize,
  writeResult,
  type ModelCall,
  type RunError,
  type Verdict,
} from "../core/result.ts";
import { runModel } from "../core/runner.ts";
import { InputError } from "../core/errors.ts";

const HELP = formatHelp({
  usage: "scenes <blueprint.json>",
  summary:
    "Generate missing public 3D scene recipes through a model binding. Keeps existing scenes and saves prompts, attempts, and scenes.json in the run. A failed generation never replaces installed artwork.",
  options: [
    ["--binding <name>", "model wrapper (default: scene-generator)"],
    [
      "--install",
      "install the validated manifest in <config root>/blueprint-scenes",
    ],
  ],
});

async function readExisting(
  dirs: string[],
  blueprint: ReturnType<typeof BlueprintV2Schema.parse>,
): Promise<SceneManifest> {
  for (const dir of dirs) {
    let text: string;
    try {
      text = await fs.readFile(path.join(dir, `${blueprint.id}.json`), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    return validateSceneManifest(JSON.parse(text), blueprint);
  }
  return { schema_version: "scene/1", blueprint_id: blueprint.id, scenes: [] };
}

async function installManifest(manifest: SceneManifest, dir: string) {
  await fs.mkdir(dir, { recursive: true });
  const destination = path.join(dir, `${manifest.blueprint_id}.json`);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: "wx",
    });
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return destination;
}

export const scenesCommand: EvalCommand = {
  name: "scenes",
  summary: "Generate missing 3D scenery from a blueprint's public setting",
  help: HELP,
  async run(argv, context) {
    const { common, values, positionals } = parseCommandArgs(argv, {
      options: { binding: { type: "string" }, install: { type: "boolean" } },
      positionals: { min: 1, max: 1 },
    });
    const blueprint = BlueprintV2Schema.parse(
      await readJsonFile(positionals[0], "blueprint"),
    );
    if (blueprint.world.locations.length > MAX_SCENE_LOCATIONS)
      throw new InputError(
        `Scene manifests support up to ${MAX_SCENE_LOCATIONS} locations`,
      );
    const dirs = [
      ...new Set([
        path.resolve(
          getBlueprintsDir(context.root, context.env),
          "..",
          "blueprint-scenes",
        ),
        path.join(context.root, "blueprint-scenes"),
      ]),
    ];
    const manifest = await readExisting(dirs, blueprint);
    const missing = blueprint.world.locations.filter(
      (location) =>
        !manifest.scenes.some((scene) => scene.location_id === location.id),
    );
    const binding = missing.length
      ? resolveBinding(
          loadConfig({
            root: context.root,
            configPath: common.configPath,
            modelOverrides: common.modelOverrides,
          }),
          String(values.binding ?? "scene-generator"),
          { root: context.root },
        )
      : null;
    const run = createRunFolder({
      root: context.root,
      command: "scenes",
      argv,
      outputRoot: resolveOutputRoot(common.outputRoot, context.env),
      bindings: binding ? [binding] : [],
    });
    const folder = run.subject({ kind: "blueprint", id: blueprint.id });
    await fs.writeFile(
      path.join(folder.dir, "blueprint.json"),
      JSON.stringify(blueprint, null, 2),
    );
    const calls: ModelCall[] = [];
    let runError: RunError | null = null;
    try {
      for (const location of missing) {
        context.out(`[scenes] generating ${location.name}`);
        const prompt = buildSceneGenerationInput(blueprint, location.id);
        const outcome = await runModel({
          ...prompt,
          binding: binding!,
          step: `scene-${manifest.scenes.length + 1}`,
          logDir: folder.logDir,
          parse(answer) {
            const scene = ProceduralSceneSchema.parse(JSON.parse(answer));
            if (scene.location_id !== location.id)
              throw new Error(
                `Expected location ${location.id}, got ${scene.location_id}`,
              );
            return validateSceneManifest(
              {
                schema_version: "scene/1",
                blueprint_id: blueprint.id,
                scenes: [scene],
              },
              blueprint,
            ).scenes[0];
          },
        });
        calls.push(outcome.call);
        if (!outcome.ok) throw new Error(outcome.error);
        manifest.scenes.push(outcome.value);
      }
      validateSceneManifest(manifest, blueprint);
      await fs.writeFile(
        path.join(folder.dir, "scenes.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      if (values.install)
        context.out(
          `[scenes] installed ${await installManifest(manifest, dirs[0])}`,
        );
      context.out(
        `[scenes] ${manifest.scenes.length} locations ready; ${folder.dir}`,
      );
    } catch (error) {
      runError = {
        stage: "scene_generation",
        message: error instanceof Error ? error.message : String(error),
      };
      context.err(`[scenes] ${runError.message}`);
    }
    const verdicts: Verdict[] = runError
      ? []
      : [
          {
            id: "scene_recipes",
            tier: "mechanical",
            status: "pass",
            details: {
              locations: manifest.scenes.length,
              generated: missing.length,
            },
          },
        ];
    await writeResult(folder.resultFile, {
      schema_version: RESULT_SCHEMA_VERSION,
      run: run.info(),
      subject: { kind: "blueprint", id: blueprint.id, path: "blueprint.json" },
      production: calls.length ? { calls } : null,
      verdicts,
      summary: summarize(verdicts, runError),
      run_error: runError,
      timing: null,
    });
    return (await run.finish()).exit_code;
  },
};
