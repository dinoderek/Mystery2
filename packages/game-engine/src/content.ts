// `ContentStore` over the filesystem.
//
// Blueprints and images already exist on disk before `seed:storage` uploads
// them, so the local implementation is the shorter path to the same bytes: no
// bucket, no download, no signed URL, and therefore no expiry to refresh.
//
// The parse semantics of the Supabase adapter are kept exactly — one malformed
// blueprint is skipped and logged, never fatal, because a single bad file must
// not take down the whole catalog. What is dropped is the bounded retry around
// downloads: a local read either succeeds or fails for a reason retrying will
// not fix.

import fs from "node:fs";
import path from "node:path";
import {
  BlueprintV2Schema,
  type BlueprintV2,
} from "../../shared/src/blueprint-schema-v2.ts";
import type { BlueprintSummaryEntry, ContentStore } from "./context.ts";
import type { LogWriter } from "./logging.ts";

/** Route prefix the browser fetches blueprint images from. */
export const IMAGE_ROUTE_PREFIX = "/api/images";

export interface LocalContentOptions {
  /** Directories searched for blueprint JSON, in precedence order. */
  blueprintDirs: string[];
  /** Directory holding image files, flat, named by image id. */
  imagesDir: string;
}

interface CachedBlueprint {
  /** mtime + size of the file the blueprint was parsed from. */
  stamp: string;
  blueprint: BlueprintV2;
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
  ): BlueprintV2 | null {
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
      const blueprint = BlueprintV2Schema.parse(JSON.parse(text));
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

    for (const dir of options.blueprintDirs) {
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
      // the catalog must not shuffle between runs, and the Supabase adapter it
      // stands in for gets name-ascending order from storage `.list()`.
      const names = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name)
        .sort();

      for (const name of names) files.push(path.join(dir, name));
    }

    return files;
  }

  return {
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

      return entries;
    },

    async loadBlueprint(
      blueprintId: string,
      logger: LogWriter,
    ): Promise<BlueprintV2 | null> {
      if (isSafeSegment(blueprintId)) {
        for (const dir of options.blueprintDirs) {
          const blueprint = readBlueprintFile(
            path.join(dir, `${blueprintId}.json`),
            logger,
          );
          if (blueprint) return blueprint;
        }
      }

      // Authored blueprints are not always filed under `<id>.json` — the same
      // fallback the Supabase adapter does over the bucket.
      for (const filePath of blueprintFiles()) {
        const blueprint = readBlueprintFile(filePath, logger);
        if (blueprint?.id === blueprintId) return blueprint;
      }

      return null;
    },

    async imageUrl(storageKey: string): Promise<string | null> {
      // `<blueprint id>/<image filename>`, the key `seed:storage` uploads to.
      const [blueprintId, imageFilename, ...rest] = storageKey.split("/");
      if (
        rest.length > 0 ||
        !isSafeSegment(blueprintId ?? "") ||
        !isSafeSegment(imageFilename ?? "")
      ) {
        return null;
      }

      // Images are stored flat, one copy per filename, shared across
      // blueprints that reference the same art.
      if (!fs.existsSync(path.join(options.imagesDir, imageFilename))) {
        return null;
      }

      // Same-origin and permanent: there is no signature and nothing to expire,
      // so the `expiresInSeconds` the contract passes is not used here.
      return `${IMAGE_ROUTE_PREFIX}/${encodeURIComponent(blueprintId)}/${encodeURIComponent(imageFilename)}`;
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
