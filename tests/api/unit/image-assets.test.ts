import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildImageStorageKey,
  ensureCanonicalImageId,
  isCanonicalImageId,
} from "../../../packages/game-engine/src/images.ts";
import { conventionalImageId } from "../../../packages/shared/src/image-ids.ts";
import { createImageId } from "../../../scripts/lib/image-prompt-builder.mjs";

const COMMITTED_CASES_DIR = path.resolve(import.meta.dirname, "../../../blueprints/clue-graph");

const CANONICAL_FILENAME =
  "mock-blueprint.blueprint.png";

describe("image helper utilities", () => {
  it("accepts canonical image filenames and rejects invalid shapes", () => {
    expect(isCanonicalImageId(CANONICAL_FILENAME)).toBe(true);
    expect(isCanonicalImageId("not-valid")).toBe(false);
    expect(isCanonicalImageId("missing-ext-123e4567-e89b-12d3-a456-426614174111")).toBe(false);
    expect(ensureCanonicalImageId(CANONICAL_FILENAME)).toBe(CANONICAL_FILENAME);
    expect(ensureCanonicalImageId("bad-id")).toBeNull();
  });

  it("creates expected storage key from blueprint id and image filename", () => {
    expect(
      buildImageStorageKey(
        "123e4567-e89b-12d3-a456-426614174000",
        CANONICAL_FILENAME,
      ),
    ).toBe(
      `123e4567-e89b-12d3-a456-426614174000/${CANONICAL_FILENAME}`,
    );
  });

  it("generated image IDs pass canonical validation when .png extension is appended", () => {
    const cases = [
      { name: "The Missing Insignia", type: "blueprint", key: null },
      { name: "The Missing Insignia", type: "location", key: "school-library-e6440f7f-e44a-4ba3-baa3-0d503bb65369" },
      { name: "The Missing Insignia", type: "character", key: "detective-jane-abc12345-1234-1234-1234-123456789abc" },
      { name: "Mock Blueprint", type: "blueprint", key: null },
      { name: "Mock Blueprint", type: "character", key: "char-alice" },
    ];

    for (const { name, type, key } of cases) {
      const baseId = createImageId(name, type, key);
      const imageId = `${baseId}.png`;
      expect(
        isCanonicalImageId(imageId),
        `"${imageId}" (from name="${name}", type="${type}", key="${key}") rejected by isCanonicalImageId`,
      ).toBe(true);
    }
  });

  it("accepts the snake_case location and character ids clue graphs use", () => {
    for (const id of [
      "missing-blue-rosette.location-tea_stall.png",
      "missing-blue-rosette.character-mrs_okafor.webp",
      "case_one.location-front_hall.jpeg",
    ]) {
      expect(isCanonicalImageId(id), id).toBe(true);
    }
  });

  it("still rejects anything that could leave the images directory or is not an image", () => {
    for (const id of [
      "../secrets.blueprint.png",
      "case.location-..png",
      "case..png",
      ".case.blueprint.png",
      "case/x.blueprint.png",
      "case\\x.blueprint.png",
      "case.location-tea stall.png",
      "case._hidden.png",
      "case.blueprint.svg",
      "case.blueprint.png.exe",
      "case.blueprint.gif",
      "case.blueprint",
      "case.blueprint.png\0",
      "",
      42,
      null,
    ]) {
      expect(isCanonicalImageId(id), String(id)).toBe(false);
    }
  });

  it("every committed case's conventional image ids are canonical", () => {
    const files = fs.readdirSync(COMMITTED_CASES_DIR).filter((file) => file.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const graph = JSON.parse(fs.readFileSync(path.join(COMMITTED_CASES_DIR, file), "utf-8"));
      const caseId: string = graph.metadata.id;
      const ids = [
        conventionalImageId(caseId, "blueprint"),
        ...Object.keys(graph.locations).map((key) => conventionalImageId(caseId, "location", key)),
        ...Object.keys(graph.characters).map((key) => conventionalImageId(caseId, "character", key)),
      ];
      for (const id of ids) {
        expect(isCanonicalImageId(id), `${file}: "${id}"`).toBe(true);
      }
    }
  });
});
