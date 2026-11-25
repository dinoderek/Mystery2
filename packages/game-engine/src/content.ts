// `ContentStore` over the filesystem.
//
// One malformed blueprint is skipped and logged, never fatal: a single bad
// file must not take down the whole catalog. It is logged once per version of
// the file, not on every listing.
//
// A case that names no image for a target is given the image filed under that
// target's conventional name in the images directory, when there is one
// (`shared/src/image-ids.ts`): a committed case names no image ids, or only
// those, and its art lives beside every other case's.

import fs from "node:fs";
import path from "node:path";
import type { PlayableCase } from "../../shared/src/playable-case.ts";
import { buildClueGraphWorld } from "../../shared/src/clue-graph-case.ts";
import { validateClueGraph } from "../../shared/src/clue-graph-validator.ts";
import { CLUE_GRAPH_FORMAT, type ClueGraphCase } from "../../shared/src/clue-graph-schema.ts";
import { conventionalImageId, type ImageTargetType } from "../../shared/src/image-ids.ts";
import type { BlueprintSummaryEntry, ContentStore } from "./context.ts";
import type { LogWriter } from "./logging.ts";
import { validateSceneManifest, type SceneManifest } from "../../shared/src/scene-schema.ts";

export interface LocalContentOptions {
  /** Directories searched for blueprint JSON, in precedence order. */
  blueprintDirs: string[];
  /** Directory holding image files, flat, named by image id. */
  imagesDir: string;
  sceneDirs: string[];
  /**
   * List the test fixtures (`FIXTURE_CASE_IDS`) in the player's catalog. They
   * load by id either way.
   */
  listFixtures?: boolean;
}

/** Cases that exist for the suites, not for players. */
export const FIXTURE_CASE_IDS: ReadonlySet<string> = new Set(["mock-case"]);

/** A file's version, as the cache sees it, and what reading it gave. */
type CachedRead =
  | { stamp: string; graph: ClueGraphCase }
  | { stamp: string; failure: string };


/** The format a case file names, under any key a case format has used, or "none". */
function formatNameOf(candidate: unknown): string {
  const named = candidate as { format?: unknown; $format?: unknown; schema_version?: unknown } | null;
  const format = named?.format ?? named?.$format ?? named?.schema_version;
  return typeof format === "string" ? format : "none";
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
  // is unchanged, so editing a blueprint takes effect without a restart, and a
  // file that fails is logged again only once it changes.
  const cache = new Map<string, CachedRead>();

  /** The case with every image it does not name filled from the images directory. */
  function withFiledImages(graph: ClueGraphCase): ClueGraphCase {
    const caseId = graph.metadata.id;
    if (!isSafeSegment(caseId)) return graph;
    const filed = (targetType: ImageTargetType, targetKey: string | null = null): string | undefined => {
      const imageId = conventionalImageId(caseId, targetType, targetKey);
      return isSafeSegment(imageId) && fs.existsSync(path.join(options.imagesDir, imageId)) ? imageId : undefined;
    };
    const cover = graph.metadata.image_id ?? filed("blueprint");
    return {
      ...graph,
      metadata: { ...graph.metadata, ...(cover ? { image_id: cover } : {}) },
      characters: Object.fromEntries(Object.entries(graph.characters).map(([id, person]) => {
        const portrait = person.portrait_image_id ?? filed("character", id);
        return [id, portrait ? { ...person, portrait_image_id: portrait } : person];
      })),
      locations: Object.fromEntries(Object.entries(graph.locations).map(([id, place]) => {
        const image = place.location_image_id ?? filed("location", id);
        return [id, image ? { ...place, location_image_id: image } : place];
      })),
    };
  }

  /** The file's case, read or from the cache; null, logged on its first failure, when it has none. */
  function readCaseFile(filePath: string, logger?: LogWriter): ClueGraphCase | null {
    let stats: fs.Stats;
    try {
      stats = fs.statSync(filePath);
    } catch (statError) {
      // Missing is the common case (probing for `<id>.json`) and is not worth
      // a log line; anything else is.
      if ((statError as NodeJS.ErrnoException).code !== "ENOENT") {
        logger?.logError("blueprint.read_failed", {
          object: path.basename(filePath),
          error: statError instanceof Error ? statError.message : String(statError),
        });
      }
      return null;
    }

    const stamp = stampOf(stats);
    const cached = cache.get(filePath);
    if (cached?.stamp === stamp) return "graph" in cached ? cached.graph : null;

    let text: string;
    try {
      text = fs.readFileSync(filePath, "utf-8");
    } catch (readError) {
      // Not cached: a file that cannot be read now may be readable next time.
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
      // The clue graph is the one case format; any other is rejected by its name.
      const format = formatNameOf(candidate);
      if (format !== CLUE_GRAPH_FORMAT) throw new Error(`Unknown case format: ${format}`);
      const graph = validateClueGraph(candidate);
      cache.set(filePath, { stamp, graph });
      return graph;
    } catch (parseError) {
      const failure = parseError instanceof Error ? parseError.message : String(parseError);
      cache.set(filePath, { stamp, failure });
      logger?.logError("blueprint.parse_failed", { object: path.basename(filePath), error: failure });
      return null;
    }
  }

  function readBlueprintFile(filePath: string, logger?: LogWriter): PlayableCase | null {
    const graph = readCaseFile(filePath, logger);
    return graph ? buildClueGraphWorld(withFiledImages(graph)) : null;
  }

  /** Every `*.json` under the configured directories, in precedence order. */
  function blueprintFiles(): string[] {
    const files: string[] = [];

    for (const dir of options.blueprintDirs.flatMap((dir) => [dir, path.join(dir, "clue-graph")])) {
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
    async loadScenes(blueprint: PlayableCase): Promise<SceneManifest | null> {
      if (!isSafeSegment(blueprint.id)) return null;
      for (const dir of options.sceneDirs) {
        let text: string;
        try {
          text = fs.readFileSync(path.join(dir, `${blueprint.id}.json`), "utf8");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
        return validateSceneManifest(JSON.parse(text), blueprint);
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
        const fixture = FIXTURE_CASE_IDS.has(blueprint.clue_graph.metadata.id);
        entries.push({
          blueprint,
          source: path.basename(filePath),
          ...(fixture && !options.listFixtures ? { unlisted: true as const } : {}),
        });
      }

      return entries;
    },

    async loadBlueprint(
      blueprintId: string,
      logger: LogWriter,
    ): Promise<PlayableCase | null> {
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
