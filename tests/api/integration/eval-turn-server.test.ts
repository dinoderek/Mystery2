// `judge turn` replaying through a throwaway server, on the suite's build.
//
// The harness starts a server of its own on a temporary config root, seeds each
// case's fixed history into that root's database and plays the case's line on
// the mock provider. This proves the one thing a unit test cannot: that the
// session was seeded in the temporary database, and that no database outside
// that root was opened. It starts the build the suite already made, because
// building again would replace the files the suite's own server is running from.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { startTestServer } from "../../../scripts/lib/test-server.mjs";
import { openDatabase } from "../../../packages/game-engine/src/db/client.ts";
import { runEval } from "../../../evaluation/core/dispatch.ts";
import { readResult } from "../../../evaluation/core/result.ts";
import { readSummary } from "../../../evaluation/runtime/lib/expect-summary.ts";
import { createJudgeTurnCommand } from "../../../evaluation/runtime/judge-turn.ts";
import type { StartServer, ThrowawayServer } from "../../../evaluation/runtime/lib/replay-server.ts";

const REPO_ROOT = process.cwd();
const CASES = "evaluation/runtime/cases/clue-graph/mock-case/readability.ts";
const EXPECT_CASES = "evaluation/runtime/cases/clue-graph/mock-case/expect.ts";

/** What the suite's own runner points its server at, so this one cannot reach a real model either. */
const MOCK_ONLY_ENV = {
  OPENROUTER_URL: "http://127.0.0.1:9/unreachable",
  CLAUDE_CLI_PATH: "/nonexistent/claude-cli-disabled-in-mock-tests",
  AI_CALL_LOG: "",
};

let scratch = "";
let decoy = "";

beforeAll(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-eval-turn-server-"));
  // Anything that resolved a config root from the environment would land here.
  decoy = fs.mkdtempSync(path.join(scratch, "play-config-root-"));
  vi.stubEnv("MYSTERY_CONFIG_ROOT", decoy);
  vi.stubEnv("MYSTERY_DATABASE", "");
});

afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(scratch, { recursive: true, force: true });
});

function repoDatabases(): string[] {
  const dir = path.join(REPO_ROOT, "database");
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

describe("judge turn through a throwaway server", () => {
  it("seeds the temporary database, plays the mock, and opens no other database", async () => {
    const before = repoDatabases();
    const config = path.join(scratch, "config.json");
    fs.writeFileSync(config, JSON.stringify({}));

    let started: ThrowawayServer | null = null;
    const seeded: Array<Record<string, unknown>> = [];
    const played: Array<Record<string, unknown>> = [];
    const startServer: StartServer = async (options) => {
      const server = (await startTestServer({ ...options, build: false, env: MOCK_ONLY_ENV })) as ThrowawayServer;
      started = server;
      return {
        ...server,
        stop: async () => {
          // Read what the harness left in the server's database before it goes.
          const db = openDatabase({ path: server.databaseFile, readonly: true });
          seeded.push(...(db.prepare("select ai_profile_id from game_sessions").all() as Array<Record<string, unknown>>));
          played.push(...(db.prepare("select event_type, actor from game_events order by created_at").all() as Array<Record<string, unknown>>));
          db.close();
          await server.stop();
        },
      };
    };

    const lines: string[] = [];
    const outputRoot = path.join(scratch, "out");
    const code = await runEval(
      ["judge", "turn", CASES, "--narrator", "server", "--ai-profile", "mock", "--judges", "flesch", "--config", config, "--output-root", outputRoot],
      { root: REPO_ROOT, out: (text) => lines.push(text), err: (text) => lines.push(text), env: process.env },
      [createJudgeTurnCommand({ startServer })],
    );
    expect(lines.join("\n")).toContain("ask-alice-alibi-pressure__server -> flesch:");
    expect(code).toBe(0);

    // Seeded in the server's own database, under the profile asked for.
    const server = started as ThrowawayServer | null;
    expect(server).not.toBeNull();
    expect(server?.databaseFile.startsWith(server?.configRoot as string)).toBe(true);
    expect(seeded.map((session) => session.ai_profile_id)).toEqual(["mock", "mock"]);
    // Each case's history plus the line that was played: the ask has two prior events, the talk one.
    expect(played.map((event) => event.event_type).sort()).toEqual(["ask", "ask", "move", "talk", "talk"]);

    // The server and its root are gone, and nothing else was opened.
    expect(fs.existsSync(server?.configRoot as string)).toBe(false);
    expect(fs.readdirSync(decoy)).toEqual([]);
    expect(repoDatabases()).toEqual(before);

    const [day] = fs.readdirSync(outputRoot);
    const [run] = fs.readdirSync(path.join(outputRoot, day));
    const subjects = fs.readdirSync(path.join(outputRoot, day, run)).filter((name) => name !== "run.json");
    expect(subjects).toHaveLength(2);
    for (const subject of subjects) {
      const result = await readResult(path.join(outputRoot, day, run, subject, "result.json"));
      expect(result.summary.passed).toBe(true);
      expect(result.production).toBeNull();
      const turn = JSON.parse(fs.readFileSync(path.join(outputRoot, day, run, subject, "turn.json"), "utf8"));
      expect(turn).toMatchObject({ narrator: "server", model: "mock" });
      expect(turn.response.narration_text.length).toBeGreaterThan(0);
    }
  }, 60_000);

  it("grades an expect case on what the server saved, over every sample", async () => {
    const config = path.join(scratch, "config-expect.json");
    fs.writeFileSync(config, JSON.stringify({}));
    const startServer: StartServer = (options) => startTestServer({ ...options, build: false, env: MOCK_ONLY_ENV }) as Promise<ThrowawayServer>;

    const lines: string[] = [];
    const outputRoot = path.join(scratch, "out-expect");
    const code = await runEval(
      ["judge", "turn", EXPECT_CASES, "--narrator", "server", "--ai-profile", "mock", "--samples", "2", "--config", config, "--output-root", outputRoot],
      { root: REPO_ROOT, out: (text) => lines.push(text), err: (text) => lines.push(text), env: process.env },
      [createJudgeTurnCommand({ startServer })],
    );
    expect(code, lines.join("\n")).toBe(0);

    const [day] = fs.readdirSync(outputRoot);
    const [run] = fs.readdirSync(path.join(outputRoot, day));
    const summary = readSummary(path.join(outputRoot, day, run));
    expect(summary.complete).toBe(true);
    expect(summary.narrators.map((entry) => [entry.narrator, entry.model])).toEqual([["server", "mock"]]);
    // The mock reveals the clue in the spot a search names, the answer Alice gives about noon, and a win for a well-argued accusation.
    expect(summary.narrators[0].cases.map((entry) => [entry.id, entry.right, entry.graded])).toEqual([
      ["search-pantry-shelf-reveals-jar", 2, 2],
      ["ask-alice-noon-shares-pantry", 2, 2],
      ["accuse-alice-won", 2, 2],
    ]);
    expect(summary.narrators[0].groups.map((entry) => [entry.group, entry.share])).toEqual([
      ["example-should-reveal", 1],
      ["example-should-give", 1],
      ["example-accuse", 1],
    ]);
  }, 60_000);

  it("replays a clue-graph case with its private snapshot seeded, on the mock", async () => {
    const config = path.join(scratch, "config-graph.json");
    fs.writeFileSync(config, JSON.stringify({}));
    const caseFile = path.join(scratch, "greenhouse-case.json");
    fs.writeFileSync(
      caseFile,
      JSON.stringify({
        id: "ask-toby-last-night",
        blueprint: { path: "blueprints/clue-graph/greenhouse-prizewinner.json" },
        given: {
          mode: "talk",
          location_id: "potting_shed",
          talk_character_id: "toby",
          time_remaining: 9,
          history: [
            { event_type: "move", narration: "You step into the potting shed.", payload: { location_id: "potting_shed", clue_graph: { type: "move", location: "potting_shed" } } },
            { event_type: "talk", narration: "Toby looks up from the pots.", payload: { character_id: "toby", location_id: "potting_shed", clue_graph: { type: "talk", character: "toby" } } },
          ],
        },
        action: { type: "ask", player_input: "Where were you last night?" },
      }),
    );

    const saved: { sessions: Array<Record<string, unknown>>; events: Array<Record<string, unknown>> } = { sessions: [], events: [] };
    const startServer: StartServer = async (options) => {
      const server = (await startTestServer({ ...options, build: false, env: MOCK_ONLY_ENV })) as ThrowawayServer;
      return {
        ...server,
        stop: async () => {
          const db = openDatabase({ path: server.databaseFile, readonly: true });
          saved.sessions.push(...(db.prepare("select blueprint_id, clue_graph_snapshot from game_sessions").all() as Array<Record<string, unknown>>));
          saved.events.push(...(db.prepare("select event_type, payload from game_events order by sequence").all() as Array<Record<string, unknown>>));
          db.close();
          await server.stop();
        },
      };
    };

    const lines: string[] = [];
    const outputRoot = path.join(scratch, "out-graph");
    const code = await runEval(
      ["judge", "turn", caseFile, "--narrator", "server", "--ai-profile", "mock", "--judges", "flesch", "--config", config, "--output-root", outputRoot],
      { root: REPO_ROOT, out: (text) => lines.push(text), err: (text) => lines.push(text), env: process.env },
      [createJudgeTurnCommand({ startServer })],
    );
    expect(code, lines.join("\n")).toBe(0);

    // Seeded with the case's own graph, so the turn played the snapshot.
    expect(saved.sessions).toHaveLength(1);
    expect(JSON.parse(saved.sessions[0].clue_graph_snapshot as string).metadata.id).toBe("greenhouse-prizewinner");
    expect(saved.events.map((event) => event.event_type)).toEqual(["move", "talk", "ask"]);
    // The line the server played is a recorded clue-graph line of Toby's.
    expect(JSON.parse(saved.events[2].payload as string).clue_graph).toMatchObject({ type: "line", character: "toby" });

    const [day] = fs.readdirSync(outputRoot);
    const [run] = fs.readdirSync(path.join(outputRoot, day));
    const [subject] = fs.readdirSync(path.join(outputRoot, day, run)).filter((name) => name !== "run.json");
    const turn = JSON.parse(fs.readFileSync(path.join(outputRoot, day, run, subject, "turn.json"), "utf8"));
    expect(turn).toMatchObject({ narrator: "server", model: "mock" });
    expect(turn.response.narration_text.length).toBeGreaterThan(0);
  }, 60_000);
});
