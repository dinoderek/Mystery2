// The endpoint registry.
//
// Each endpoint is a `handle(req, ctx) => Response`, a list of methods it
// answers, and the access it runs under. One SvelteKit route
// (`web/src/routes/api/[endpoint]/+server.ts`) reads this table to check the
// method, build the right context and delegate — once, for all of them, in
// place of the twelve identical bootstraps this replaced.
//
// Adding an endpoint means adding it here: an unlisted name is a 404.
//
// ## Access
//
// Two behaviours, and the table below is where an endpoint picks one:
//
// - `"profile"` — the endpoint manages or plays a game session, so it runs as
//   somebody. The route rejects it without a profile, and it is handed an
//   `EngineContext` whose session and event stores are scoped to that profile.
// - `"catalog"` — the endpoint only reads content every profile shares. It
//   needs nobody, so the route does not ask for one, and it is handed a
//   `CatalogContext` that has no owned state on it to scope.
//
// The distinction is about *ownership*, not secrecy: the game is one process
// on the player's own machine, and a profile is how one person's cases stay
// separate from another's, not a wall against them. So the question to ask of
// a new endpoint is only ever "does this touch somebody's sessions?" — if it
// does not, it is `"catalog"`.

import type { CatalogContext, EngineContext } from "../context.ts";

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

/** Which of the two behaviours above an endpoint runs under. */
export type EndpointAccess = "profile" | "catalog";

interface EndpointBase {
  /** Path segment the browser calls: `/api/<name>`. */
  name: string;
  methods: readonly EndpointMethod[];
}

/** Runs as a profile, over state that belongs to it. */
export interface ProfileEndpoint extends EndpointBase {
  access: "profile";
  handle: (req: Request, ctx: EngineContext) => Promise<Response>;
}

/** Runs without one, over content every profile shares. */
export interface CatalogEndpoint extends EndpointBase {
  access: "catalog";
  handle: (req: Request, ctx: CatalogContext) => Promise<Response>;
}

export type EndpointDefinition = ProfileEndpoint | CatalogEndpoint;

const POST_ONLY: readonly EndpointMethod[] = ["POST"];
const GET_ONLY: readonly EndpointMethod[] = ["GET"];
const GET_OR_POST: readonly EndpointMethod[] = ["GET", "POST"];

export const ENDPOINTS: readonly EndpointDefinition[] = [
  { name: "blueprints-list", access: "catalog", methods: GET_OR_POST, handle: blueprintsList.handle },
  { name: "game-accuse", access: "profile", methods: POST_ONLY, handle: gameAccuse.handle },
  { name: "game-ask", access: "profile", methods: POST_ONLY, handle: gameAsk.handle },
  { name: "game-end-talk", access: "profile", methods: POST_ONLY, handle: gameEndTalk.handle },
  { name: "game-enter", access: "profile", methods: POST_ONLY, handle: gameEnter.handle },
  { name: "game-get", access: "profile", methods: GET_ONLY, handle: gameGet.handle },
  { name: "game-move", access: "profile", methods: POST_ONLY, handle: gameMove.handle },
  { name: "game-search", access: "profile", methods: POST_ONLY, handle: gameSearch.handle },
  { name: "game-sessions-list", access: "profile", methods: GET_OR_POST, handle: gameSessionsList.handle },
  { name: "game-start", access: "profile", methods: POST_ONLY, handle: gameStart.handle },
  { name: "game-talk", access: "profile", methods: POST_ONLY, handle: gameTalk.handle },
];

const BY_NAME = new Map(ENDPOINTS.map((endpoint) => [endpoint.name, endpoint]));

/** Returns null for a name no endpoint answers to. */
export function findEndpoint(name: string): EndpointDefinition | null {
  return BY_NAME.get(name) ?? null;
}
