import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GameStartResponseSchema } from "@my2/shared";
import { startOwnServer, type OwnServer } from "../../testkit/src/own-server";
import { MOCK_BLUEPRINT_ID } from "./helpers";

// A model call joins to the event it narrated by `request_id`. The server here
// writes the AI call log, which the suite's server does not.

let server: OwnServer;
let scratch: string;
let callLog: string;

beforeAll(async () => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "call-log-join-"));
  callLog = path.join(scratch, "ai-calls.jsonl");
  server = await startOwnServer({ env: { AI_CALL_LOG: callLog } });
});

afterAll(async () => {
  await server?.stop();
  fs.rmSync(scratch, { recursive: true, force: true });
});

interface LoggedCall {
  game_id: string;
  endpoint: string;
  request_id: string;
  latency_ms: unknown;
}

function loggedCalls(gameId: string): LoggedCall[] {
  return fs
    .readFileSync(callLog, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as LoggedCall)
    .filter((call) => call.game_id === gameId);
}

function storedRequestIds(gameId: string): Array<{ event_type: string; request_id: string | null }> {
  return server
    .database()
    .prepare("select event_type, request_id from game_events where session_id = ? order by sequence")
    .all(gameId) as Array<{ event_type: string; request_id: string | null }>;
}

describe("the call log and the events", () => {
  it("name the same request for every turn, and every call has a latency", async () => {
    const auth = await server.createPlayer("call-log-join");
    const post = (endpoint: string, body: unknown) =>
      fetch(`${server.apiUrl}/${endpoint}`, { method: "POST", headers: auth.headers, body: JSON.stringify(body) });

    const started = GameStartResponseSchema.parse(await (await post("game-start", { blueprint_id: MOCK_BLUEPRINT_ID })).json());
    const gameId = started.game_id;
    expect((await post("game-turn", { game_id: gameId, input: "search the kitchen" })).status).toBe(200);
    expect((await post("game-turn", { game_id: gameId, input: "go to the Living Room" })).status).toBe(200);

    const calls = loggedCalls(gameId);
    const events = storedRequestIds(gameId);

    // Every saved event names a request, and each such request made a model call.
    expect(events.map((event) => event.event_type)).toEqual(["start", "search", "move"]);
    for (const event of events) expect(event.request_id).toEqual(expect.any(String));
    expect(new Set(events.map((event) => event.request_id)).size).toBe(events.length);
    expect(calls.map((call) => call.request_id)).toEqual(events.map((event) => event.request_id));

    for (const call of calls) expect(typeof call.latency_ms).toBe("number");
  });
});
