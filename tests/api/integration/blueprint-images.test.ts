import { describe, expect, it } from "vitest";

import {
  BASE_URL,
  MOCK_BLUEPRINT_ID,
  removeTestImage,
  seedTestImage,
  STUB_PNG,
} from "./helpers";
import { collectBlueprintImageReferences } from "../../../scripts/lib/blueprint-image-manifest.mjs";
import { buildImageStorageKey } from "../../../packages/game-engine/src/images.ts";
import { readMockCase } from "../../testkit/src/mock-case";
import { clueGraphCaseId } from "../../../packages/shared/src/clue-graph-case.ts";

// The contract: the image ids a blueprint names are the files the server
// serves, at the path `blueprintImageUrl()` builds — and only those.
//
// Artwork is content, so none of this runs as a profile; that these requests
// carry no cookie is part of what they assert.

describe("blueprint images", () => {
  it("serves every image the blueprint references, at the path the link endpoint returns", async () => {
    const blueprint = readMockCase();
    const references = collectBlueprintImageReferences(blueprint);
    expect(references.length).toBeGreaterThanOrEqual(3); // cover + location + portrait

    for (const reference of references) {
      seedTestImage(reference.imageFilename);
    }

    for (const reference of references) {
      const key = buildImageStorageKey(MOCK_BLUEPRINT_ID, reference.imageFilename);
      const bytesRes = await fetch(`${BASE_URL}/api/images/${key}`);

      expect(bytesRes.status, key).toBe(200);
      expect(bytesRes.headers.get("content-type")).toBe("image/png");
      expect(new Uint8Array(await bytesRes.arrayBuffer())).toEqual(STUB_PNG);
    }
  });

  it("serves an image's compressed copy in its place, under the id the blueprint names", async () => {
    const portrait = collectBlueprintImageReferences(readMockCase()).find((reference: { purpose: string }) => reference.purpose === "character_portrait")!.imageFilename as string;
    const compressed = portrait.replace(/\.png$/u, ".webp");
    const webpBytes = new TextEncoder().encode("RIFF-stand-in-webp");
    seedTestImage(portrait);
    seedTestImage(compressed, webpBytes);

    try {
      const bytesRes = await fetch(`${BASE_URL}/api/images/${buildImageStorageKey(MOCK_BLUEPRINT_ID, portrait)}`);

      expect(bytesRes.status).toBe(200);
      expect(bytesRes.headers.get("content-type")).toBe("image/webp");
      expect(new Uint8Array(await bytesRes.arrayBuffer())).toEqual(webpBytes);
    } finally {
      removeTestImage(compressed);
    }
  });

  it("404s an image the blueprint does not reference, even when the file exists", async () => {
    // The private bucket's read policy became this check, and it is the whole
    // of what confines the route: the blueprint has to name the image.
    seedTestImage("mock-case.unreferenced.png");

    const bytesRes = await fetch(
      `${BASE_URL}/api/images/${MOCK_BLUEPRINT_ID}/mock-case.unreferenced.png`,
    );
    expect(bytesRes.status).toBe(404);
  });

  it("404s a referenced image whose file is missing", async () => {
    const blueprint = readMockCase();
    const coverId = blueprint.metadata.image_id!;

    // An earlier test in this file may have seeded it; the case under test is
    // a blueprint that names an image nobody has generated yet. The cover is
    // this file's to delete — suites in a run share one image directory, so no
    // other suite may seed it.
    removeTestImage(coverId);

    const bytesRes = await fetch(`${BASE_URL}/api/images/${MOCK_BLUEPRINT_ID}/${coverId}`);
    expect(bytesRes.status).toBe(404);
  });

  it("serves a committed case's filed art for a snake_case location, under the .png id it names", async () => {
    // A committed case names no image ids: the engine fills each one from the
    // images directory under `conventionalImageId`'s name. Location ids are
    // snake_case, so the route has to take an underscore.
    // The route names the case by its catalog id, not its `metadata.id`.
    const blueprintId = clueGraphCaseId("missing-blue-rosette");
    const imageId = "missing-blue-rosette.location-tea_stall.png";
    seedTestImage(imageId);

    try {
      const bytesRes = await fetch(`${BASE_URL}/api/images/${blueprintId}/${imageId}`);
      expect(bytesRes.status).toBe(200);
      expect(new Uint8Array(await bytesRes.arrayBuffer())).toEqual(STUB_PNG);

      // The compressed copy is served in the original's place, never by its
      // own name: the blueprint names only the .png.
      const webpRes = await fetch(
        `${BASE_URL}/api/images/${blueprintId}/${imageId.replace(/\.png$/u, ".webp")}`,
      );
      expect(webpRes.status).toBe(404);
    } finally {
      removeTestImage(imageId);
    }
  });

  it("rejects an image id that is not a canonical filename", async () => {
    const bytesRes = await fetch(
      `${BASE_URL}/api/images/${MOCK_BLUEPRINT_ID}/${encodeURIComponent("../secrets.png")}`,
    );
    expect(bytesRes.status).toBe(400);
  });
});
