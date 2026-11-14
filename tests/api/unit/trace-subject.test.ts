import { describe, expect, it } from "vitest";

import { projectTraceSubject } from "../../../evaluation/judges/subject.ts";
import { reconstructTrace } from "../../../evaluation/trace/lib/reconstruct.ts";
import { makeRawTrace } from "./trace-fixtures";

type ProjTurn = {
  role_name: string | null;
  sequence: number;
  narration: string;
  judged: boolean;
  prior_revealed_clue_ids: string[];
};

describe("projectTraceSubject", () => {
  it("keeps only game-master turns and carries the narration", () => {
    const { turns } = reconstructTrace(makeRawTrace());
    const subject = projectTraceSubject(turns);
    const projected: ProjTurn[] = subject.turns;
    expect(projected.every((t) => t.role_name !== null)).toBe(true);
    expect(projected.find((t) => t.sequence === 2)?.narration).toMatch(/muddy footprint/);
    expect(projected.some((t) => t.sequence === 1)).toBe(false); // start dropped
  });

  it("judges every turn of a trace and accumulates prior reveals", () => {
    const { turns } = reconstructTrace(makeRawTrace());
    const subject = projectTraceSubject(turns);
    const projected: ProjTurn[] = subject.turns;
    expect(subject.subject_kind).toBe("trace");
    expect(projected.every((t) => t.judged)).toBe(true);
    expect(subject.judged_sequences).toEqual(projected.map((t) => t.sequence));
    // The first turn has nothing before it; a later turn carries what earlier
    // turns revealed, which is what gates the clue-discipline judge.
    expect(projected[0].prior_revealed_clue_ids).toEqual([]);
    const lastPriors = projected[projected.length - 1].prior_revealed_clue_ids;
    expect(lastPriors.length).toBeGreaterThan(0);
  });
});
