// `ContentStore` over the filesystem.
//
// One malformed blueprint is skipped and logged, never fatal: a single bad
// file must not take down the whole catalog.

import fs from "node:fs";
import path from "node:path";
import {
  BlueprintV2Schema,
} from "../../shared/src/blueprint-schema-v2.ts";
import { buildMsfBlueprint, validateMsfCaseFile, type PlayableBlueprint } from "../../shared/src/msf-case.ts";
import type { BlueprintSummaryEntry, ContentStore } from "./context.ts";
import type { LogWriter } from "./logging.ts";
import { validateSceneManifest, type SceneManifest } from "../../shared/src/scene-schema.ts";

export interface LocalContentOptions {
  /** Directories searched for blueprint JSON, in precedence order. */
  blueprintDirs: string[];
  /** Directory holding image files, flat, named by image id. */
  imagesDir: string;
  sceneDirs: string[];
}

interface CachedBlueprint {
  /** mtime + size of the file the blueprint was parsed from. */
  stamp: string;
  blueprint: PlayableBlueprint;
}

function stampOf(stats: fs.Stats): string {
  return `${stats.mtimeMs}:${stats.size}`;
}

/** Rejects anything that could escape the images directory. */
function isSafeSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    !segment.includes("/") &&
    !segment.includes("\\") &&
    !segment.includes("\0")
  );
}

export function createLocalContentStore(
  options: LocalContentOptions,
): ContentStore {
  // Keyed on absolute path. An entry survives only while the file it came from
  // is unchanged, so editing a blueprint takes effect without a restart.
  const cache = new Map<string, CachedBlueprint>();

  function readBlueprintFile(
    filePath: string,
    logger?: LogWriter,
  ): PlayableBlueprint | null {
    let stats: fs.Stats;
    let text: string;
    try {
      stats = fs.statSync(filePath);
      const cached = cache.get(filePath);
      if (cached && cached.stamp === stampOf(stats)) return cached.blueprint;
      text = fs.readFileSync(filePath, "utf-8");
    } catch (readError) {
      // Missing is the common case (probing for `<id>.json`) and is not worth
      // a log line; anything else is.
      if ((readError as NodeJS.ErrnoException).code !== "ENOENT") {
        logger?.logError("blueprint.read_failed", {
          object: path.basename(filePath),
          error: readError instanceof Error ? readError.message : String(readError),
        });
      }
      return null;
    }

    try {
      const candidate = JSON.parse(text);
      const blueprint = candidate?.$format === "MSF-CASE/1"
        ? buildMsfBlueprint(validateMsfCaseFile(candidate))
        : BlueprintV2Schema.parse(candidate);
      cache.set(filePath, { stamp: stampOf(stats), blueprint });
      return blueprint;
    } catch (parseError) {
      logger?.logError("blueprint.parse_failed", {
        object: path.basename(filePath),
        error: parseError instanceof Error ? parseError.message : String(parseError),
      });
      return null;
    }
  }

  /** Every `*.json` under the configured directories, in precedence order. */
  function blueprintFiles(): string[] {
    const files: string[] = [];

    for (const dir of options.blueprintDirs.flatMap((dir) => [dir, path.join(dir, "msf")])) {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (error) {
        // An absent directory is an empty one — the config root need not have
        // a `blueprints/` folder. Anything else is a real failure.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }

      // `readdirSync` order is filesystem-dependent, so it is sorted here:
      // the catalog must not shuffle between runs or between machines.
      const names = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name)
        .sort();

      for (const name of names) files.push(path.join(dir, name));
    }

    return files;
  }

  return {
    async loadScenes(blueprint: PlayableBlueprint): Promise<SceneManifest | null> {
      if (!isSafeSegment(blueprint.id)) return null;
      const assetId = blueprint.msf?.paired_blueprint_id ?? blueprint.id;
      for (const dir of options.sceneDirs) {
        let text: string;
        try {
          text = fs.readFileSync(path.join(dir, `${assetId}.json`), "utf8");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
        return { ...validateSceneManifest(JSON.parse(text), { ...blueprint, id: assetId }), blueprint_id: blueprint.id };
      }
      return null;
    },
    async listBlueprints(logger?: LogWriter): Promise<BlueprintSummaryEntry[]> {
      const entries: BlueprintSummaryEntry[] = [];
      // The same blueprint can sit in both the config root and the repo's seed
      // directory; the earlier directory wins so the catalog has no duplicates.
      const seen = new Set<string>();

      for (const filePath of blueprintFiles()) {
        const blueprint = readBlueprintFile(filePath, logger);
        if (!blueprint || seen.has(blueprint.id)) continue;

        seen.add(blueprint.id);
        entries.push({ blueprint, source: path.basename(filePath) });
      }

      return entries.sort((a, b) => Number(!!a.blueprint.msf) - Number(!!b.blueprint.msf));
    },

    async loadBlueprint(
      blueprintId: string,
      logger: LogWriter,
    ): Promise<PlayableBlueprint | null> {
      if (isSafeSegment(blueprintId)) {
        for (const dir of options.blueprintDirs) {
          const blueprint = readBlueprintFile(
            path.join(dir, `${blueprintId}.json`),
            logger,
          );
          if (blueprint) return blueprint;
        }
      }

      // Authored blueprints are not always filed under `<id>.json`, so fall
      // back to matching on the id inside the file.
      for (const filePath of blueprintFiles()) {
        const blueprint = readBlueprintFile(filePath, logger);
        if (blueprint?.id === blueprintId) return blueprint;
      }

      return null;
    },
  };
}

/** Absolute path of an image file, or null when it is missing or unsafe. */
export function resolveImageFile(
  imagesDir: string,
  imageFilename: string,
): string | null {
  if (!isSafeSegment(imageFilename)) return null;
  const absolute = path.join(imagesDir, imageFilename);
  return fs.existsSync(absolute) ? absolute : null;
}
