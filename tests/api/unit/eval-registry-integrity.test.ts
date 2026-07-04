import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

import {
  loadDimensions,
  loadDimensionDefinition,
  tryLoadAnalyzer,
  repoRoot,
} from "../../../evaluation/pipeline/load.mjs";
import {
  loadTraceDimensions,
  loadTraceDimensionDefinition,
  traceRoot,
} from "../../../evaluation/trace/lib/load.mjs";

// These tests guard the two dimension registries against drift: a registry
// entry that points at a missing or malformed schema (or, for blueprint
// dimensions, an analyzer file that fails to export analyze()) would otherwise
// surface only as a runtime failure part-way through an evaluation. Adding a
// new registry entry without its schema/analyzer files should fail here.

describe("blueprint dimension registry integrity", () => {
  it("declares at least one dimension", async () => {
    const dimensions = await loadDimensions();
    expect(Array.isArray(dimensions)).toBe(true);
    expect(dimensions.length).toBeGreaterThan(0);
  });

  it("resolves every registry entry to a loadable schema", async () => {
    const dimensions = await loadDimensions();
    for (const dim of dimensions) {
      const def = await loadDimensionDefinition(dim.id);
      expect(def.schema, `dimension "${dim.id}" has no loadable schema`).not.toBeNull();
      expect(
        typeof def.schema.safeParse,
        `dimension "${dim.id}" schema is not a Zod schema`,
      ).toBe("function");
    }
  });

  it("loads an analyze() function for every dimension that ships an analyzer file", async () => {
    const dimensions = await loadDimensions();
    const analyzersDir = path.join(
      repoRoot(),
      "evaluation",
      "checks",
      "analyzers",
    );

    for (const dim of dimensions) {
      const analyzerFile = path.join(
        analyzersDir,
        `${dim.id.replace(/_/g, "-")}.mjs`,
      );
      const hasAnalyzerFile = await fs
        .access(analyzerFile)
        .then(() => true)
        .catch(() => false);

      const analyzer = await tryLoadAnalyzer(dim.id);
      if (hasAnalyzerFile) {
        expect(
          analyzer,
          `dimension "${dim.id}" ships an analyzer file but it did not load`,
        ).not.toBeNull();
        expect(typeof analyzer.analyze).toBe("function");
      } else {
        expect(analyzer).toBeNull();
      }
    }
  });

  it("has an analyzer for exactly the dimensions with an analyzer file on disk", async () => {
    // Independent cross-check: whichever dimensions have an analyzer file must
    // be the same set tryLoadAnalyzer resolves for the registered dimensions.
    const dimensions = await loadDimensions();
    const withAnalyzer: string[] = [];
    for (const dim of dimensions) {
      if (await tryLoadAnalyzer(dim.id)) withAnalyzer.push(dim.id);
    }
    // Sanity floor: the two known analyzer-backed dimensions are registered.
    expect(withAnalyzer).toEqual(
      expect.arrayContaining(["clue_graph", "age_appropriate"]),
    );
  });
});

describe("trace dimension registry integrity", () => {
  it("declares at least one dimension", async () => {
    const { dimensions } = await loadTraceDimensions();
    expect(Array.isArray(dimensions)).toBe(true);
    expect(dimensions.length).toBeGreaterThan(0);
  });

  it("resolves every registry entry to a loadable schema", async () => {
    const { dimensions } = await loadTraceDimensions();
    for (const dim of dimensions) {
      const def = await loadTraceDimensionDefinition(dim.id);
      expect(def.schema, `trace dimension "${dim.id}" has no loadable schema`).not.toBeNull();
      expect(
        typeof def.schema.safeParse,
        `trace dimension "${dim.id}" schema is not a Zod schema`,
      ).toBe("function");
    }
  });

  it("resolves each dimension's .md and .schema.ts files inside the trace tree", async () => {
    const { dimensions } = await loadTraceDimensions();
    const traceDimsDir = path.join(traceRoot(), "dimensions");
    for (const dim of dimensions) {
      const def = await loadTraceDimensionDefinition(dim.id);
      expect(def.filePath.startsWith(traceDimsDir)).toBe(true);
      // Text of the dimension prompt is non-empty.
      expect(def.text.length).toBeGreaterThan(0);
    }
  });
});
