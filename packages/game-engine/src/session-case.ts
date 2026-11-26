// The case a session plays: the private clue-graph snapshot saved when it
// started, else the blueprint as it is on disk today. It carries no reading
// age: that is the reader's (`reading-age.ts`).

import { buildClueGraphWorld } from "../../shared/src/clue-graph-case.ts";
import type { PlayableCase } from "../../shared/src/playable-case.ts";
import type { ContentStore, GameSessionRow } from "./context.ts";
import type { LogWriter } from "./logging.ts";

export async function sessionCase(
  content: ContentStore,
  session: GameSessionRow,
  logger: LogWriter,
): Promise<PlayableCase | null> {
  return session.clue_graph_snapshot
    ? buildClueGraphWorld(session.clue_graph_snapshot)
    : await content.loadBlueprint(session.blueprint_id, logger);
}
