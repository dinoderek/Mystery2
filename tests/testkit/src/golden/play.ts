// Plays one scripted game over HTTP and returns what the player saw.

import { BrowserDriver, type GameDriver, type StartState } from "./driver.ts";
import { Screen, type ScriptStep } from "./screen.ts";

export interface PlayOptions {
  apiUrl: string;
  /** Authenticates as the profile that plays, and sends JSON. */
  headers: HeadersInit;
  blueprintId: string;
  script: ScriptStep[];
  /**
   * How lines reach the game. The browser's own routing by default; whatever
   * replaces it passes its own driver and nothing else here changes.
   */
  makeDriver?: (game: { apiUrl: string; headers: HeadersInit; gameId: string; start: StartState }) => GameDriver;
}

async function getJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${url} answered ${response.status}: ${await response.text()}`);
  return (await response.json()) as Record<string, unknown>;
}

export async function playScriptedGame(options: PlayOptions): Promise<Screen> {
  const { apiUrl, headers, blueprintId, script } = options;

  const list = await getJson(`${apiUrl}/blueprints-list`, { headers });
  const blueprints = list.blueprints as Array<{ id: string; title: string }>;
  const blueprint = blueprints.find((entry) => entry.id === blueprintId);
  if (!blueprint) throw new Error(`Blueprint ${blueprintId} is not listed`);

  const started = await getJson(`${apiUrl}/game-start`, {
    method: "POST",
    headers,
    body: JSON.stringify({ blueprint_id: blueprintId }),
  });
  const gameId = started.game_id as string;
  const state = started.state as StartState & { time_remaining: number };

  const screen = new Screen({
    mysteryTitle: blueprint.title,
    mode: state.mode,
    time_remaining: state.time_remaining,
    events: (started.narration_events as Array<{ event_type: string; narration_parts: never[] }>).map((event) => ({
      event_type: event.event_type,
      narration_parts: event.narration_parts,
    })),
  });

  const makeDriver = options.makeDriver ?? ((game) => new BrowserDriver(game));
  await screen.play(makeDriver({ apiUrl, headers, gameId, start: state }), script);
  return screen;
}
