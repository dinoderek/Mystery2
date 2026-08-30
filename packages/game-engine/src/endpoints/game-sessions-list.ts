import type { EngineContext, GameSessionSummaryRow } from "../context.ts";
import { internalError } from "../errors.ts";

type SessionOutcome = "win" | "lose" | null;

interface SessionSummary {
  game_id: string;
  blueprint_id: string;
  mystery_title: string;
  mystery_available: boolean;
  can_open: boolean;
  mode: GameSessionSummaryRow["mode"];
  time_remaining: number;
  outcome: SessionOutcome;
  last_played_at: string;
  created_at: string;
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

function toSummary(
  session: GameSessionSummaryRow,
  titleByBlueprintId: Map<string, string>,
): SessionSummary {
  const title = titleByBlueprintId.get(session.blueprint_id);
  const mystery_available = Boolean(title);

  return {
    game_id: session.id,
    blueprint_id: session.blueprint_id,
    mystery_title: title ?? "Unknown Mystery",
    mystery_available,
    can_open: mystery_available,
    mode: session.mode,
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
      toSummary(session, titleByBlueprintId)
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
