import { describe, expect, it } from "vitest";
import { parseCommand, type ParseContext } from "../../../web/src/lib/domain/parser";

const CONTEXT: ParseContext = {
  locations: [
    { id: "loc-grand-library", name: "The Grand Library" },
    { id: "loc-kitchen", name: "Kitchen" },
    { id: "loc-secret-garden", name: "Secret Garden" },
  ],
  characters: [
    { id: "char-alice", first_name: "Alice", last_name: "Smith", location_name: "loc-grand-library" },
  ],
  currentLocation: "loc-grand-library",
};

function moveDestination(input: string): string | null {
  const result = parseCommand(input, "explore", CONTEXT);
  if (result.type === "valid" && result.command.type === "move") {
    return result.command.destination;
  }
  return null;
}

describe("location resolution for move command", () => {
  it("resolves by exact location ID", () => {
    expect(moveDestination("go to loc-kitchen")).toBe("loc-kitchen");
  });

  it("resolves by full location name (case-insensitive)", () => {
    expect(moveDestination("move to The Grand Library")).toBe("loc-grand-library");
    expect(moveDestination("move to the grand library")).toBe("loc-grand-library");
    expect(moveDestination("go to SECRET GARDEN")).toBe("loc-secret-garden");
  });

  it("resolves by a single word from the location name", () => {
    expect(moveDestination("go to kitchen")).toBe("loc-kitchen");
    expect(moveDestination("go to library")).toBe("loc-grand-library");
    expect(moveDestination("go to garden")).toBe("loc-secret-garden");
  });

  it("strips leading 'the' for matching", () => {
    expect(moveDestination("go to grand library")).toBe("loc-grand-library");
  });

  it("returns null for an unknown location", () => {
    expect(moveDestination("go to dungeon")).toBeNull();
  });

  it("returns the location ID, not the name", () => {
    const dest = moveDestination("move to secret garden");
    expect(dest).toBe("loc-secret-garden");
    expect(dest).not.toBe("Secret Garden");
  });
});
