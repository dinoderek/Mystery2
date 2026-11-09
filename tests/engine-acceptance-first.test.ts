import { describe, expect, it } from "vitest";

describe("engine acceptance: first", () => {
  it("joins two words with a hyphen", () => {
    expect(["a", "b"].join("-")).toBe("a-b");
  });
});
