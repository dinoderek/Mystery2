// The playing profile's settings: today, the reading age its new games start at.
//
// `GET` reads them; `POST` replaces them, a null age clearing the setting so
// each new game reads at its case's own age. A game already started keeps the
// age it saved (`docs/game.md`).

import {
  ProfileSettingsUpdateSchema,
  type ProfileSettings,
} from "../../../shared/src/mystery-api-contracts.ts";
import type { EngineContext } from "../context.ts";
import { internalError } from "../errors.ts";
import { createRequestLogger } from "../logging.ts";
import { readJsonRequest } from "../request.ts";

async function settingsResponse(ctx: EngineContext): Promise<Response> {
  const settings: ProfileSettings = { reading_age: await ctx.profile.getReadingAge() };
  return new Response(JSON.stringify(settings), { headers: { "Content-Type": "application/json" } });
}

export async function handle(req: Request, ctx: EngineContext): Promise<Response> {
  const logger = createRequestLogger(req, "profile-settings");
  try {
    if (req.method === "POST") {
      const read = await readJsonRequest(req, ProfileSettingsUpdateSchema, logger);
      if (!read.ok) return read.response;
      await ctx.profile.setReadingAge(read.data.reading_age);
      logger.log("profile.reading_age_set", { reading_age: read.data.reading_age });
    }
    return await settingsResponse(ctx);
  } catch (err) {
    logger.logError("request.unhandled_error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return internalError("Internal Server Error");
  }
}
