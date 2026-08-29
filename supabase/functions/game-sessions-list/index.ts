import type { EngineContext } from "../_shared/context.ts";
import { requireEngineContext } from "../_shared/context-supabase.ts";
import { internalError } from "../_shared/errors.ts";
import { serveWithCors } from "../_shared/cors.ts";

type SessionMode = "explore" | "talk" | "accuse" | "ended";
type SessionOutcome = "win" | "lose" | null;

interface SessionRow {
  id: string;
  blueprint_id: string;
  mode: string;
  time_remaining: number;
  outcome: string | null;
  updated_at: string;
  created_at: string;
}

interface SessionSummary {
  game_id: string;
  blueprint_id: string;
  mystery_title: string;
  mystery_available: boolean;
  can_open: boolean;
  mode: SessionMode;
  time_remaining: number;
  outcome: SessionOutcome;
  last_played_at: string;
  created_at: string;
}

function readMode(value: string): SessionMode {
  if (value === "explore" || value === "talk" || value === "accuse" || value === "ended") {
    return value;
  }

  return "explore";
}

function readOutcome(value: string | null): SessionOutcome {
  if (value === "win" || value === "lose") {
    return value;
  }

  return null;
}

function readTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(0).toISOString();
  }

  return parsed.toISOString();
}

function compareByRecency(a: SessionSummary, b: SessionSummary): number {
  const byLastPlayed = b.last_played_at.localeCompare(a.last_played_at);
  if (byLastPlayed !== 0) {
    return byLastPlayed;
  }

  const byCreated = b.created_at.localeCompare(a.created_at);
  if (byCreated !== 0) {
    return byCreated;
  }

  return b.game_id.localeCompare(a.game_id);
}

async function loadBlueprintTitles(
  ctx: EngineContext,
): Promise<Map<string, string>> {
  const entries = await ctx.content.listBlueprints();
  return new Map(
    entries.map(({ blueprint }) => [blueprint.id, blueprint.metadata.title]),
  );
}

function toSummary(session: SessionRow, titleByBlueprintId: Map<string, string>): SessionSummary {
  const title = titleByBlueprintId.get(session.blueprint_id);
  const mystery_available = Boolean(title);

  return {
    game_id: session.id,
    blueprint_id: session.blueprint_id,
    mystery_title: title ?? "Unknown Mystery",
    mystery_available,
    can_open: mystery_available,
    mode: readMode(session.mode),
    time_remaining: Number.isFinite(session.time_remaining)
      ? Math.max(0, Math.trunc(session.time_remaining))
      : 0,
    outcome: readOutcome(session.outcome),
    last_played_at: readTimestamp(session.updated_at),
    created_at: readTimestamp(session.created_at),
  };
}

export async function handle(
  req: Request,
  ctx: EngineContext,
): Promise<Response> {
  try {
    let sessions;
    try {
      sessions = await ctx.sessions.listForPlayer();
    } catch {
      return internalError("Failed to fetch sessions");
    }

    const titleByBlueprintId = await loadBlueprintTitles(ctx);

    const summaries = sessions.map((session) =>
      toSummary(session as SessionRow, titleByBlueprintId)
    );

    const inProgress = summaries
      .filter((summary) => summary.mode !== "ended")
      .sort(compareByRecency);

    const completed = summaries
      .filter((summary) => summary.mode === "ended")
      .sort(compareByRecency);

    return new Response(
      JSON.stringify({
        in_progress: inProgress,
        completed,
        counts: {
          in_progress: inProgress.length,
          completed: completed.length,
        },
      }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error(error);
    return internalError("Internal Server Error");
  }
}

serveWithCors(async (req) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const ctx = await requireEngineContext(req);
  if (ctx instanceof Response) return ctx;

  return handle(req, ctx);
});
