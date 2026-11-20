# Self-play games behind the clue-reveal case libraries (2026-11-20)

Each folder holds a game's `trace.json`, the blueprint it was played on (`blueprint.json`, also embedded in the trace) and its judged `result.json`. Narrator: Haiku. Copied from `/Users/dinohughes/mysteryevals/2026-11-20/`.

| Folder | Blueprint | Persona | Turn(s) | What went wrong |
| --- | --- | --- | --- | --- |
| `search-tower` | The Missing Heartwood (`lucia-heartwood`) | detective | seq 11, "search under the lifeguard tower" | `clue_buried_heartwood` unlocked (pointer `clue_footprint_trail` found at seq 9) and in `search_context`; narrator returned null ("Just cool sand and one leaf. Try the Lily Pool reeds!") |
| `search-trolley` | The Midnight Express Bird Heist (`003-midnight-express`, repaired) | kid-7 | seq 13, "search under the parcel trolley tarpaulin" | `trolley_hatbox` unlocked (prerequisite `wally_echo` held); narrator withheld it; game lost |
| `talk-toby` | The Missing Heartwood (`lucia-heartwood`) | kid-7 | seq 18 and 19 (asks to Toby) | player presented `clue_pink_feather`, sole leverage gate for `clue_toby_glade_visit`; Toby deflected, no use recorded |
| `talk-wanda` | Howard Roundtail and the Snowline Briefcase (`large-snow-foxes`, round 3) | kid-7 | seq 24 and 25 (asks to Wanda) | player pressed the wolf pawprints, which earn Wanda's `clue_wolf_pawprints` self-protect part; she kept denying |
