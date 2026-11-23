import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMsfBlueprint,
  validateMsfCaseFile,
  evaluateMysteryStructure,
  GameStartResponseSchema,
  GameTurnResponseSchema,
  GameGetResponseSchema,
  type MsfCaseFile,
} from "@my2/shared";
import { BlueprintV2Schema } from "../../../packages/shared/src/blueprint-schema-v2.ts";
import {
  createLocalEngine,
  type LocalEngine,
} from "../../../packages/game-engine/src/context-local.ts";
import type { EngineContext } from "../../../packages/game-engine/src/context.ts";
import {
  createAIProviderFromProfile,
  type AIProvider,
} from "../../../packages/game-engine/src/ai-provider.ts";
import { handle as startGame } from "../../../packages/game-engine/src/endpoints/game-start.ts";
import { handle as getGame } from "../../../packages/game-engine/src/endpoints/game-get.ts";
import { handle as listSessions } from "../../../packages/game-engine/src/endpoints/game-sessions-list.ts";
import { playTurn } from "../../../packages/game-engine/src/turn/play-turn.ts";
import {
  buildRoleRequest,
  buildNarrationPrompt,
} from "../../../packages/game-engine/src/role-request.ts";
import { RetriableAIError } from "../../../packages/game-engine/src/errors.ts";
import {
  createLocalTraceSource,
  extractSessionTrace,
} from "../../../evaluation/trace/lib/datasource.ts";
import { reconstructTrace } from "../../../evaluation/trace/lib/reconstruct.ts";
import { readBlueprint } from "../../../evaluation/runtime/lib/case.ts";
import { composeJudgeUserMessage } from "../../../evaluation/core/judge-prompt.ts";
import {
  createMsfCaseFile,
  createMysteryStructure,
} from "../../testkit/src/fixtures.ts";

const ROOT = process.cwd();
const PAIR_FILE = path.join(ROOT, "blueprints/msf/lighthouse.json");
const MSF_ID = "46e4e135-82fe-4389-af0b-80aa749867a1";
const V2_ID = "7c3e9a52-4f1b-4d8e-9a6c-2b5f1e8d3a47";
const silent = { log: () => {}, logError: () => {} };
const session = {
  mode: "talk" as const,
  current_location_id: "keepers_cottage",
  current_talk_character_id: "finn",
  time_remaining: 8,
};
function lighthouse() {
  return validateMsfCaseFile(JSON.parse(fs.readFileSync(PAIR_FILE, "utf8")));
}
function allClueIds(file: MsfCaseFile) {
  return Object.entries(file.structure.nodes)
    .filter(([, node]) => node.kind === "clue")
    .map(([id]) => id);
}

describe("native MSF representation", () => {
  it("pairs the same case, locations, people, clues and artwork without flattening the deduction graph", () => {
    const file = lighthouse();
    const msf = buildMsfBlueprint(file);
    const v2 = BlueprintV2Schema.parse(
      JSON.parse(
        fs.readFileSync("blueprints/the-missing-lighthouse-lens.json", "utf8"),
      ),
    );
    expect(file.paired_blueprint_id).toBe(v2.id);
    expect(msf.narrative).toEqual(v2.narrative);
    expect(msf.metadata.target_age).toBe(v2.metadata.target_age);
    expect(msf.metadata.time_budget).toBe(v2.metadata.time_budget);
    expect(
      msf.world.locations.map((loc) => [loc.id, loc.name, loc.description]),
    ).toEqual(
      v2.world.locations.map((loc) => [loc.id, loc.name, loc.description]),
    );
    const texts = (bp: Pick<typeof v2, "world">) =>
      [
        ...bp.world.locations.flatMap((loc) => [
          ...loc.clues,
          ...loc.sub_locations.flatMap((spot) => spot.clues),
        ]),
        ...bp.world.characters.flatMap((char) => char.clues),
      ]
        .map((clue) => [clue.id, clue.text])
        .sort();
    expect(texts(msf)).toEqual(texts(v2));
    expect(msf.cover_image).toEqual(v2.cover_image);
    expect(msf.solution_paths).toEqual([]);
    expect(
      evaluateMysteryStructure(file.structure, allClueIds(file))
        .solution_supported,
    ).toBe(true);
    expect(BlueprintV2Schema.safeParse(msf).success).toBe(false);
  });

  it("keeps AND/OR dependencies and false claims distinct from established facts", () => {
    const file = lighthouse();
    const empty = evaluateMysteryStructure(file.structure, [
      "r_solution",
      "f_roz_stole",
      "unknown",
    ]);
    expect(empty.solution_supported).toBe(false);
    const claim = evaluateMysteryStructure(file.structure, [
      "c_roz_blames_finn",
    ]);
    expect(claim.heard_claim_ids).toContain("claim_roz_blames_finn");
    expect(claim.known_fact_ids).not.toContain("f_finn_stole");
    const timing = evaluateMysteryStructure(file.structure, [
      "c_harbour_tide_board",
    ]);
    expect(timing.supported_rule_ids).toContain("r_timing_observation");
    expect(timing.supported_rule_ids).not.toContain("r_real_tide");
    expect(timing.solution_supported).toBe(false);
    const clear = evaluateMysteryStructure(file.structure, [
      "c_round_bundle",
      "c_finn_birthday_sign",
    ]);
    expect(clear.known_fact_ids).toContain("f_bundle_is_lens");
    expect(file.structure.nodes.f_bundle_is_lens).toMatchObject({
      truth: false,
    });
    expect(clear.solution_supported).toBe(false);
  });

  it("rejects private truth in presentation, mismatched entities and unknown search spots", () => {
    const file = createMsfCaseFile();
    expect(() =>
      validateMsfCaseFile({
        ...file,
        presentation: { ...file.presentation, ground_truth: "injected" },
      }),
    ).toThrow();
    expect(() =>
      validateMsfCaseFile({
        ...file,
        paired_blueprint_id: file.structure.metadata.id,
      }),
    ).toThrow("own case id");
    for (const kind of ["locations", "characters"] as const) {
      const draft = structuredClone(file);
      if (kind === "locations")
        draft.presentation.locations.push(draft.presentation.locations[0]);
      else draft.presentation.characters.push(draft.presentation.characters[0]);
      expect(() => validateMsfCaseFile(draft)).toThrow("match graph IDs");
    }
    const draft = structuredClone(file);
    draft.structure.nodes.note = {
      kind: "clue",
      text: "A note.",
      source: { kind: "search", location_id: "hall", spot: "unknown" },
      establishes_fact_ids: ["motive"],
      reports_claim_ids: [],
    };
    expect(() => validateMsfCaseFile(draft)).toThrow("Unknown MSF search spot");
    expect(() =>
      validateMsfCaseFile({ ...file, structure: createMysteryStructure() }),
    ).toThrow();
  });

  it("does not concede a cover from evidence merely held, and keeps confronted evidence scoped to its character", async () => {
    const file = lighthouse();
    const blueprint = buildMsfBlueprint(file);
    const ids = allClueIds(file);
    const discovery = {
      sequence: 1,
      event_type: "search",
      actor: "system",
      narration: "Recorded discoveries.",
      payload: { revealed_clue_ids: ids },
    };
    const input = {
      role: "talk_conversation" as const,
      game_id: "test",
      blueprint,
      character_id: "roz",
      location_id: "village_quay",
      player_input: "Tell me what happened.",
      session: {
        ...session,
        current_location_id: "village_quay",
        current_talk_character_id: "roz",
      },
    };
    const before = (
      await buildRoleRequest({ ...input, conversation_history: [discovery] })
    ).context.talk_context!.active_character;
    expect(
      before.msf?.claims.find((claim) => claim.id === "claim_roz_alibi")
        ?.disproved,
    ).toBe(false);
    expect(before.state.current_story.join(" ")).not.toContain(
      "Evidence disproves",
    );
    expect(before.gate_clues.map((clue) => clue.id)).toContain(
      "c_beacon_poster",
    );
    const foreignUse = {
      sequence: 2,
      event_type: "ask",
      actor: "system",
      narration: "Questioned Finn.",
      payload: { character_id: "finn", used_clue_ids: ids },
    };
    const foreign = (
      await buildRoleRequest({
        ...input,
        conversation_history: [discovery, foreignUse],
      })
    ).context.talk_context!.active_character;
    expect(
      foreign.msf?.claims.find((claim) => claim.id === "claim_roz_alibi")
        ?.disproved,
    ).toBe(false);
    const ownUse = {
      ...foreignUse,
      payload: { character_id: "roz", used_clue_ids: ids },
    };
    const after = (
      await buildRoleRequest({
        ...input,
        conversation_history: [discovery, ownUse],
      })
    ).context.talk_context!.active_character;
    expect(
      after.msf?.claims.find((claim) => claim.id === "claim_roz_alibi")
        ?.disproved,
    ).toBe(true);
    expect(after.state.current_story.join(" ")).toContain("Evidence disproves");
  });

  it("projects only the active character's native knowledge, never the complete graph, into conversation", async () => {
    const file = lighthouse();
    file.structure.nodes.fact_roz_action_5 = {
      kind: "fact",
      text: "PRIVATE_OTHER_CHARACTER",
      truth: true,
      about_ids: ["roz"],
    };
    const blueprint = buildMsfBlueprint(file);
    const input = {
      game_id: "test",
      session,
      blueprint,
      character_id: "finn",
      location_id: "keepers_cottage",
      conversation_history: [],
    };
    for (const role of [
      "talk_start",
      "talk_conversation",
      "talk_end",
    ] as const) {
      const request = await buildRoleRequest({
        ...input,
        role,
        player_input: "What happened?",
      });
      expect(
        request.context.talk_context?.active_character.msf?.known_facts.length,
      ).toBeGreaterThan(0);
      expect(JSON.stringify(request.context)).not.toContain(
        "PRIVATE_OTHER_CHARACTER",
      );
      expect(JSON.stringify(request.context)).not.toContain(
        "paired_blueprint_id",
      );
      expect(request.prompt).toContain("Knowledge is not automatic disclosure");
    }
    const arrival = buildNarrationPrompt({
      role: "ambience",
      game_id: "test",
      blueprint,
      destination_id: "keepers_cottage",
    });
    expect(arrival).not.toContain("PRIVATE_OTHER_CHARACTER");
    expect(arrival).not.toContain("knows_fact_ids");
    const judge = await buildRoleRequest({
      role: "accusation_judge",
      game_id: "test",
      session: { ...session, mode: "accuse" },
      blueprint,
      player_input: "Roz",
      last_accusation: false,
    });
    expect(judge.context.accusation_judge_context?.full_blueprint.msf).toEqual(
      file,
    );
    expect(
      judge.context.accusation_judge_context?.msf_progress?.solution_supported,
    ).toBe(false);
    expect(
      composeJudgeUserMessage("gm_broad", null, { blueprint, subject: {} }),
    ).toContain("representation_note");
    const replay = await readBlueprint(PAIR_FILE, ROOT);
    expect(replay.blueprint.msf).toEqual(lighthouse());
  });
});

describe("MSF sessions and turns", () => {
  let scratch: string;
  let local: LocalEngine;
  let ctx: EngineContext;
  let databasePath: string;
  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "msf-play-"));
    databasePath = path.join(scratch, "test.db");
    local = createLocalEngine({
      repoRoot: ROOT,
      env: { MYSTERY_CONFIG_ROOT: scratch },
      databasePath,
    });
    ctx = local.contextFor({ id: local.players.ensure("MSF investigator").id });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    local.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  async function start(id = MSF_ID) {
    const response = await startGame(
      new Request("http://test/api/game-start", {
        method: "POST",
        body: JSON.stringify({ blueprint_id: id }),
      }),
      ctx,
    );
    expect(response.status).toBe(200);
    return GameStartResponseSchema.parse(await response.json());
  }
  async function play(
    gameId: string,
    input: string,
    createProvider?: (
      profile: Parameters<typeof createAIProviderFromProfile>[0],
    ) => AIProvider,
  ) {
    const result = GameTurnResponseSchema.parse(
      await playTurn(
        ctx,
        { game_id: gameId, input },
        {
          req: new Request("http://test/api/game-turn"),
          request_id: "test",
          logger: silent,
          createProvider,
        },
      ),
    );
    if (result.kind !== "turn")
      throw new Error(`Not a turn: ${input}: ${JSON.stringify(result)}`);
    return result;
  }
  async function install(file: MsfCaseFile) {
    const dir = path.join(scratch, "blueprints/msf");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "test.json"), JSON.stringify(file));
    return start(file.structure.metadata.id);
  }
  function gated(kind: "physical" | "social" | "knowledge", talk = false) {
    const file = createMsfCaseFile();
    file.structure.nodes.key = {
      kind: "clue",
      text: "A key.",
      source: { kind: "search", location_id: "hall" },
      establishes_fact_ids: [],
      reports_claim_ids: [],
    };
    file.structure.nodes.note = {
      kind: "clue",
      text: "PRIVATE_LOCKED_NOTE",
      source: talk
        ? { kind: "talk", character_id: "ada" }
        : { kind: "search", location_id: "hall", spot: "cabinet" },
      establishes_fact_ids: ["motive"],
      reports_claim_ids: [],
      requires: { clue_ids: ["key"], kind, rationale: "The key is needed." },
    };
    file.presentation.locations[0].sub_locations = [
      { id: "cabinet", name: "cabinet", hint: "A cabinet." },
    ];
    return validateMsfCaseFile(file);
  }

  it("keeps V2 first, reuses paired scenery and pins the source without exposing it through the API", async () => {
    const entries = await ctx.content.listBlueprints(silent);
    expect(
      entries.findIndex((entry) => entry.blueprint.id === V2_ID),
    ).toBeLessThan(entries.findIndex((entry) => entry.blueprint.id === MSF_ID));
    const native = entries.find(
      (entry) => entry.blueprint.id === MSF_ID,
    )!.blueprint;
    expect((await ctx.content.loadScenes(native))?.blueprint_id).toBe(MSF_ID);
    const started = await start();
    expect(JSON.stringify(started)).not.toContain("knows_fact_ids");
    expect(JSON.stringify(started)).not.toContain("msf_snapshot");
    expect((await ctx.sessions.getById(started.game_id))?.msf_snapshot).toEqual(
      lighthouse(),
    );
    const v2 = await start(V2_ID);
    expect(
      (await ctx.sessions.getById(v2.game_id))?.msf_snapshot,
    ).toBeUndefined();
  });

  it("resumes and extracts the pinned revision even if the catalog source disappears", async () => {
    const opened = await start();
    const playerId = ctx.player.id;
    local.close();
    local = createLocalEngine({
      repoRoot: ROOT,
      env: { MYSTERY_CONFIG_ROOT: scratch },
      databasePath,
    });
    ctx = local.contextFor({ id: playerId });
    vi.spyOn(ctx.content, "loadBlueprint").mockResolvedValue(null);
    vi.spyOn(ctx.content, "listBlueprints").mockResolvedValue([]);
    await play(opened.game_id, "talk to Ada");
    await play(opened.game_id, "What did you hear?");
    const response = await getGame(
      new Request(`http://test/api/game-get?game_id=${opened.game_id}`),
      ctx,
    );
    expect(response.status).toBe(200);
    const data = GameGetResponseSchema.parse(await response.json());
    expect(
      (data.state.discovered_clues ?? []).map((clue) => clue.id),
    ).toContain("c_ada_snoring");
    expect(JSON.stringify(data)).not.toContain("msf_snapshot");
    expect(JSON.stringify(data)).not.toContain("f_roz_stole");
    const catalog = await (
      await listSessions(new Request("http://test/api/game-sessions-list"), ctx)
    ).json();
    expect(catalog.in_progress[0]).toMatchObject({
      can_open: true,
      mystery_title: "The Missing Lighthouse Lens — MSF experiment",
    });
    const source = createLocalTraceSource({
      databasePath,
      repoRoot: ROOT,
      env: {},
    });
    try {
      vi.spyOn(source, "downloadBlueprint").mockRejectedValue(
        new Error("source removed"),
      );
      const trace = await extractSessionTrace(source, opened.game_id);
      expect(trace.blueprint).toHaveProperty("msf", lighthouse());
      expect(reconstructTrace(trace).turns.length).toBeGreaterThan(0);
    } finally {
      source.close?.();
    }
  });

  it("refuses a mismatched or corrupt private snapshot rather than falling back to current content", async () => {
    const opened = await start();
    const other = lighthouse();
    other.structure.metadata.id = crypto.randomUUID();
    local.db
      .prepare("update game_sessions set msf_snapshot = ? where id = ?")
      .run(JSON.stringify(other), opened.game_id);
    await expect(ctx.sessions.getById(opened.game_id)).rejects.toThrow(
      "does not match",
    );
    local.db
      .prepare("update game_sessions set msf_snapshot = ? where id = ?")
      .run("{", opened.game_id);
    await expect(ctx.sessions.getById(opened.game_id)).rejects.toThrow();
    const source = createLocalTraceSource({
      databasePath,
      repoRoot: ROOT,
      env: {},
    });
    try {
      await expect(
        extractSessionTrace(source, opened.game_id),
      ).rejects.toThrow();
    } finally {
      source.close?.();
    }
  });

  it("does not bypass a physical search gate by naming the cabinet, and rejects an invalid model reveal before saving", async () => {
    const opened = await install(gated("physical"));
    const missed = await play(opened.game_id, "search cabinet");
    expect(missed.revealed_clues).toEqual([]);
    const before = await ctx.events.listBySession(opened.game_id);
    const invalid = (
      profile: Parameters<typeof createAIProviderFromProfile>[0],
    ): AIProvider => {
      const inner = createAIProviderFromProfile(profile);
      return {
        ...inner,
        profile: inner.profile,
        resolvedModel: inner.resolvedModel,
        generateNarration: inner.generateNarration.bind(inner),
        generateRoleOutput: async (request) =>
          request.parse({
            narration: "An invalid reveal.",
            revealed_clue_id: "note",
            costs_turn: true,
            input_understood: true,
          }),
      };
    };
    await expect(
      play(opened.game_id, "search cabinet", invalid),
    ).rejects.toBeInstanceOf(RetriableAIError);
    expect(await ctx.events.listBySession(opened.game_id)).toEqual(before);
    await play(opened.game_id, "search");
    expect(
      (await play(opened.game_id, "search cabinet")).revealed_clues.map(
        (clue) => clue.id,
      ),
    ).toEqual(["note"]);
  });

  it.each(["physical", "social", "knowledge"] as const)(
    "handles %s conversation gates with canonical off-script discoveries",
    async (kind) => {
      const opened = await install(gated(kind, true));
      await play(opened.game_id, "talk to Ada");
      const result = await play(
        opened.game_id,
        "aha, I bet I know what happened",
      );
      expect(result.revealed_clues.map((clue) => clue.id)).toEqual(
        kind === "physical" ? [] : ["note"],
      );
      if (kind !== "physical")
        expect(result.revealed_clues[0].off_script).toBe(true);
    },
  );

  it.each(["physical", "social"] as const)(
    "rejects unearned %s talk reveals before committing narration",
    async (kind) => {
      const file = gated(kind, true);
      const opened = await install(file);
      await play(opened.game_id, "talk to Ada");
      const before = await ctx.events.listBySession(opened.game_id);
      const invalid = (
        profile: Parameters<typeof createAIProviderFromProfile>[0],
      ): AIProvider => {
        const inner = createAIProviderFromProfile(profile);
        return {
          profile: inner.profile,
          resolvedModel: inner.resolvedModel,
          generateNarration: inner.generateNarration.bind(inner),
          generateRoleOutput: async (request) => {
            if (kind === "physical")
              expect(JSON.stringify(request.context)).not.toContain(
                "PRIVATE_LOCKED_NOTE",
              );
            return request.parse({
              narration: "An invalid reveal.",
              revealed_clue_ids: ["note"],
              revealed_off_script: [],
              input_understood: true,
              used_clue_ids: [],
              used_quote: null,
              new_commitments: [],
            });
          },
        };
      };
      await expect(
        play(opened.game_id, "Tell me", invalid),
      ).rejects.toBeInstanceOf(RetriableAIError);
      expect(await ctx.events.listBySession(opened.game_id)).toEqual(before);
    },
  );

  it("rejects a lucky culprit guess and accepts a correct reconstruction without a completed graph path", async () => {
    const opened = await start();
    await play(opened.game_id, "accuse");
    const guess = await play(opened.game_id, "Roz");
    expect(guess.result).toBeNull();
    expect(guess.state).toMatchObject({ mode: "explore", accusations_left: 2 });
    expect((await play(opened.game_id, "accuse Roz")).result).toBeNull();
    expect(
      (
        await play(
          opened.game_id,
          "accuse Roz took the lens across the causeway at low tide so her beacon would win the vote.",
        )
      ).result,
    ).toBe("win");
  });

  it.each([V2_ID, MSF_ID])(
    "plays the same lighthouse route to a last-turn accusation on %s",
    async (id) => {
      const opened = await start(id);
      let result;
      for (const input of [
        "talk to Ada",
        "What did you hear?",
        "Why did you set your alarm?",
        "bye",
        "go keepers_cottage",
        "search tide schedule",
        "talk to Finn",
        "What happened?",
        "Who was in the cottage?",
        "bye",
        "go village_quay",
        "search",
        "search harbour tide board",
        "search causeway steps",
      ]) {
        result = await play(opened.game_id, input);
      }
      expect(result?.state).toMatchObject({
        mode: "accuse",
        time_remaining: 0,
      });
      const row = await ctx.sessions.getById(opened.game_id);
      if (row?.msf_snapshot)
        expect(
          evaluateMysteryStructure(
            row.msf_snapshot.structure,
            row.discovered_clues,
          ).solution_supported,
        ).toBe(true);
      expect((await play(opened.game_id, "Roz took the lens")).result).toBe(
        "win",
      );
    },
  );
});
