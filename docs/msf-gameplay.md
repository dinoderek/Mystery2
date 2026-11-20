# Paired MSF gameplay experiment

The committed lighthouse story has two selectable versions. Blueprint V2 remains
first in the catalog; **The Missing Lighthouse Lens — MSF experiment** has its
own case ID, `46e4e135-82fe-4389-af0b-80aa749867a1`.
Both use the same premise, people, clue IDs/text, locations, turn budget and
artwork. Operator instructions: [Quickstart](../QUICKSTART.md#compare-case-formats).

## Source and runtime

`blueprints/msf/lighthouse.json` is an `MSF-CASE/1` package: a validated
[Mystery Structure](mystery-structure.md) plus presentation data. Presentation
supplies descriptions, personality, public summaries and artwork, never clues,
private knowledge, truth or deductions. Pairing refers to the committed V2
lighthouse; an independently edited V2 override needs a matching reviewed pair.

The loader builds the existing command/artwork world view, retaining the full
native structure, with `schema_version: msf/0.1.0` and empty legacy reasoning
paths. Runtime gates, character
knowledge and deductions come from MSF, not flattened paths or V2 agendas.

Search prerequisites remain hard even when a player guesses a spot. Conversation
can bypass social/knowledge gates with a recorded off-script reveal; physical
gates cannot be bypassed. Invalid model reveals fail before narration or events
are returned/saved. Characters receive only their own knowledge, claims and
beliefs; claims never establish their proposition's truth automatically.

AND/OR deductions are recomputed from recorded discoveries. The accusation
judge receives the graph and this derived progress. A supported rule alone
does not win: the player must explain the culprit with discovered evidence,
or correctly reconstruct events and motive. V2 keeps its existing behavior.

## Persistence and comparison

Database version 4 adds nullable `game_sessions.msf_snapshot`. MSF starts save
the validated source package privately in the same transaction as the opening.
Resume, entry, subsequent turns and trace extraction use that snapshot rather
than today's file. The public start event records only format and revision;
API state and notebook expose no private graph, truth values or rule membership.

Self-play accepts the MSF package by path, ID or title. A V2 recording can be
replayed with its explicitly paired MSF alternative via `--blueprint`; unrelated
case substitutions are refused. Existing checkpoints detect divergence and clue
drift. Reports retain source format/revision; trace and turn judges receive the
native graph and representation guidance. Runtime-case replay also loads MSF
and seeds its private snapshot on the throwaway server.

Keep narrator/model and inputs fixed initially. Compare disclosures, withheld
clues, contradictions, accusations and turn use. Generation remains V2; this
experiment adds neither a generator mode nor an automatic converter. The mock
tests plumbing; narrative quality still needs live comparison.
