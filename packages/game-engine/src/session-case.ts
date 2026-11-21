// The case a session plays: the private snapshot saved when it started, for
// the formats that keep one, else the blueprint as it is on disk today.

import { buildClueGraphBlueprint } from "../../shared/src/clue-graph-case.ts";
import { buildMsfBlueprint, type PlayableBlueprint } from "../../shared/src/msf-case.ts";
import type { ContentStore, GameSessionRow } from "./context.ts";
import type { LogWriter } from "./logging.ts";

export function sessionCase(
  content: ContentStore,
  session: GameSessionRow,
  logger: LogWriter,
): Promise<PlayableBlueprint | null> {
  if (session.msf_snapshot) return Promise.resolve(buildMsfBlueprint(session.msf_snapshot));
  if (session.clue_graph_snapshot) return Promise.resolve(buildClueGraphBlueprint(session.clue_graph_snapshot));
  return content.loadBlueprint(session.blueprint_id, logger);
}
