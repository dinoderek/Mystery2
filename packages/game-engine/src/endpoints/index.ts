// The endpoint registry.
//
// Each endpoint is a `handle(req, ctx) => Response` and a list of methods it
// answers. One SvelteKit route (`web/src/routes/api/[endpoint]/+server.ts`)
// reads this table to check the method, resolve the profile and build a
// context — once, for all of them, in place of the twelve identical bootstraps
// this replaced.
//
// Adding an endpoint means adding it here: an unlisted name is a 404, which
// per-function deployment used to give for free.

import type { EngineContext } from "../context.ts";

import * as blueprintsList from "./blueprints-list.ts";
import * as gameAccuse from "./game-accuse.ts";
import * as gameAsk from "./game-ask.ts";
import * as gameEndTalk from "./game-end-talk.ts";
import * as gameEnter from "./game-enter.ts";
import * as gameGet from "./game-get.ts";
import * as gameMove from "./game-move.ts";
import * as gameSearch from "./game-search.ts";
import * as gameSessionsList from "./game-sessions-list.ts";
import * as gameStart from "./game-start.ts";
import * as gameTalk from "./game-talk.ts";

export type EndpointMethod = "GET" | "POST";

export interface EndpointDefinition {
  /** Path segment the browser calls: `/api/<name>`. */
  name: string;
  methods: readonly EndpointMethod[];
  handle: (req: Request, ctx: EngineContext) => Promise<Response>;
}

const POST_ONLY: readonly EndpointMethod[] = ["POST"];
const GET_ONLY: readonly EndpointMethod[] = ["GET"];
const GET_OR_POST: readonly EndpointMethod[] = ["GET", "POST"];

export const ENDPOINTS: readonly EndpointDefinition[] = [
  { name: "blueprints-list", methods: GET_OR_POST, handle: blueprintsList.handle },
  { name: "game-accuse", methods: POST_ONLY, handle: gameAccuse.handle },
  { name: "game-ask", methods: POST_ONLY, handle: gameAsk.handle },
  { name: "game-end-talk", methods: POST_ONLY, handle: gameEndTalk.handle },
  { name: "game-enter", methods: POST_ONLY, handle: gameEnter.handle },
  { name: "game-get", methods: GET_ONLY, handle: gameGet.handle },
  { name: "game-move", methods: POST_ONLY, handle: gameMove.handle },
  { name: "game-search", methods: POST_ONLY, handle: gameSearch.handle },
  { name: "game-sessions-list", methods: GET_OR_POST, handle: gameSessionsList.handle },
  { name: "game-start", methods: POST_ONLY, handle: gameStart.handle },
  { name: "game-talk", methods: POST_ONLY, handle: gameTalk.handle },
];

const BY_NAME = new Map(ENDPOINTS.map((endpoint) => [endpoint.name, endpoint]));

/** Returns null for a name no endpoint answers to. */
export function findEndpoint(name: string): EndpointDefinition | null {
  return BY_NAME.get(name) ?? null;
}
