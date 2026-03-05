import { describe, it, expect } from "vitest";
import { generateClueId } from "../../../supabase/functions/_shared/clue-ids.ts";

describe("generateClueId", () => {
    it("generates deterministic ids based on text", async () => {
        const id1 = await generateClueId("The cookie was eaten.");
        const id2 = await generateClueId("The cookie was eaten.");

        expect(id1).toBe(id2);
        expect(id1.startsWith("clue_")).toBe(true);
        expect(id1.length).toBe(13); // 'clue_' + 8 chars
    });

    it("generates different ids for different text", async () => {
        const id1 = await generateClueId("The cookie was eaten.");
        const id2 = await generateClueId("The cookie was not eaten.");

        expect(id1).not.toBe(id2);
    });
});
