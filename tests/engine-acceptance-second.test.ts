import { describe, expect, it } from "vitest";

describe("engine acceptance: second", () => {
  it("upper-cases the word engine", () => {
    expect("engine".toUpperCase()).toBe("ENGINE");
  });
});
