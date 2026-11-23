// The case a session plays: the private snapshot saved when it started, for
// the formats that keep one, else the blueprint as it is on disk today, read
// at the game's own reading age.

import { buildClueGraphWorld } from "../../shared/src/clue-graph-case.ts";
import { buildMsfBlueprint, type PlayableCase } from "../../shared/src/msf-case.ts";
import type { ContentStore, GameSessionRow } from "./context.ts";
import type { LogWriter } from "./logging.ts";
import { atReadingAge, gameReadingAge } from "../../shared/src/reading-age.ts";

export async function sessionCase(
  content: ContentStore,
  session: GameSessionRow,
  logger: LogWriter,
): Promise<PlayableCase | null> {
  const played = session.msf_snapshot
    ? buildMsfBlueprint(session.msf_snapshot)
    : session.clue_graph_snapshot
      ? buildClueGraphWorld(session.clue_graph_snapshot)
      : await content.loadBlueprint(session.blueprint_id, logger);
  return played ? atReadingAge(played, gameReadingAge(played.metadata.target_age, session.reading_age)) : null;
}
