// The menu's case list: titles at once, and, when asked, every listed case's
// line narrated at the profile's age in one model call. The test fixture, which
// the content store marks unlisted, is never on it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handle } from "../../../packages/game-engine/src/endpoints/blueprints-list.ts";
import type { EngineContext } from "../../../packages/game-engine/src/context.ts";
import { renderComplexityGuidance } from "../../../packages/shared/src/age-profile.ts";
import { readMockCase } from "../../testkit/src/mock-case.ts";

const LISTED = readMockCase();
const SECOND = {
  ...readMockCase(),
  id: "second-id",
  metadata: { ...LISTED.metadata, title: "The Second Case", one_liner: "The bell rang twice." },
  clue_graph: { ...LISTED.clue_graph, opening: { ...LISTED.clue_graph.opening, facts: ["The bell rang twice."] } },
};
const FIXTURE = { ...readMockCase(), id: "fixture-id" };

function context(readingAge: number | null = 7): EngineContext {
  return {
    content: {
      listBlueprints: async () => [
        { blueprint: LISTED, source: "listed.json" },
        { blueprint: SECOND, source: "second.json" },
        { blueprint: FIXTURE, source: "fixture.json", unlisted: true as const },
      ],
    },
    profile: { getReadingAge: async () => readingAge },
    aiProfiles: {
      getById: async (id: string) =>
        id === "default" ? { id, provider: "openrouter", model: "test/model", openrouter_api_key: "test-key" } : null,
    },
  } as unknown as EngineContext;
}

interface Listed { id: string; title: string; one_liner: string | null }

async function list(ctx: EngineContext, query = ""): Promise<{ status: number; blueprints: Listed[] }> {
  const response = await handle(new Request(`http://localhost/api/blueprints-list${query}`), ctx);
  return { status: response.status, ...(await response.json()) };
}

function modelAnswers(content: string) {
  return vi.fn(async () => new Response(JSON.stringify({ model: "test/model", choices: [{ message: { content } }] })));
}

let errors: string[];

beforeEach(() => {
  errors = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation((line: string) => { errors.push(line); });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("blueprints-list", () => {
  it("lists every case but the unlisted ones, titles alone, with no model call", async () => {
    const fetch = modelAnswers("{}");
    vi.stubGlobal("fetch", fetch);

    const { blueprints } = await list(context());

    expect(blueprints.map((entry) => [entry.id, entry.title, entry.one_liner])).toEqual([
      [LISTED.id, LISTED.metadata.title, null],
      [SECOND.id, "The Second Case", null],
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("narrates every listed case's line at the profile's age, in one model call", async () => {
    const fetch = modelAnswers(JSON.stringify({
      lines: [
        { id: LISTED.id, line: "Someone took the cookies!" },
        { id: SECOND.id, line: "Why did the bell ring?" },
      ],
    }));
    vi.stubGlobal("fetch", fetch);

    const { blueprints } = await list(context(7), "?one_liners=true");

    expect(fetch).toHaveBeenCalledTimes(1);
    const sent = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    const user = JSON.parse(sent.messages[1].content);
    expect(user.prompt).toContain(renderComplexityGuidance(7));
    expect(user.context.one_liner_context.cases).toEqual([
      { id: LISTED.id, title: LISTED.metadata.title, fact: LISTED.clue_graph.opening.facts[0] },
      { id: SECOND.id, title: "The Second Case", fact: "The bell rang twice." },
    ]);
    expect(JSON.stringify(user)).not.toContain(FIXTURE.id);
    expect(blueprints.map((entry) => entry.one_liner)).toEqual(["Someone took the cookies!", "Why did the bell ring?"]);
  });

  it("answers a failed narration with the titles alone, logged once, and never the case's own line", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad request", { status: 400 })));

    const { status, blueprints } = await list(context(9), "?one_liners=true");

    expect(status).toBe(200);
    expect(blueprints.map((entry) => [entry.title, entry.one_liner])).toEqual([
      [LISTED.metadata.title, null],
      ["The Second Case", null],
    ]);
    for (const authored of [LISTED.metadata.one_liner, SECOND.metadata.one_liner]) {
      expect(JSON.stringify(blueprints)).not.toContain(authored);
    }
    const failures = errors.map((line) => JSON.parse(line)).filter((entry) => entry.reason === "one_liner_failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ blueprint_ids: [LISTED.id, SECOND.id], reading_age: 9 });
  });

  it("answers an output that leaves a case without a line with the titles alone", async () => {
    vi.stubGlobal("fetch", modelAnswers(JSON.stringify({ lines: [{ id: LISTED.id, line: "Only one." }] })));

    const { blueprints } = await list(context(), "?one_liners=true");

    expect(blueprints.map((entry) => entry.one_liner)).toEqual([null, null]);
    expect(errors.map((line) => JSON.parse(line).error)).toEqual([expect.stringContaining(`no line for case ${SECOND.id}`)]);
  });

  it("refuses the lines to a profile with no reading age, as a game is refused", async () => {
    const fetch = modelAnswers("{}");
    vi.stubGlobal("fetch", fetch);

    const response = await handle(new Request("http://localhost/api/blueprints-list?one_liners=true"), context(null));

    expect(response.status).toBe(400);
    expect((await response.json()).details.code).toBe("READING_AGE_REQUIRED");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("takes the request as a JSON body too, and refuses a field it cannot read", async () => {
    vi.stubGlobal("fetch", modelAnswers(JSON.stringify({ lines: [{ id: LISTED.id, line: "A." }, { id: SECOND.id, line: "B." }] })));
    const post = (body: unknown) =>
      handle(new Request("http://localhost/api/blueprints-list", { method: "POST", body: JSON.stringify(body) }), context());

    const narrated = await (await post({ one_liners: true })).json();
    expect(narrated.blueprints.map((entry: Listed) => entry.one_liner)).toEqual(["A.", "B."]);

    const refused = await post({ one_liners: "yes" });
    expect(refused.status).toBe(400);
    expect((await refused.json()).details.field).toBe("one_liners");
  });
});
