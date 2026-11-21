// The two reveals withheld in play, cut from stored self-play games with
// `./dev eval cases --types search` and given the search they were asked, and the
// clues the player held, which a cut does not carry. Both fail on Haiku with
// today's prompt: if one passes, the case is wrong, not the prompt.
//
// The history is the game's own, verbatim; the blueprint is a copy of the one it
// was played on, so the case depends on nothing outside the repo.

import type { TurnCase } from "../../lib/case.ts";

// Lucia Heartwood, detective, turn 11. The player found the glowing footprint trail at
// turn 9, which stops at Sam's tower: that unlocks the spot under it, which holds the
// buried Heartwood. Haiku narrated an empty patch of sand and sent the player to the reeds.
const underTheTower: TurnCase = {
  "id": "lucia-heartwood-under-the-tower",
  "group": "reveal-unlocked",
  "blueprint": {
    "path": "evaluation/runtime/cases/search-reveals/blueprints/missing-heartwood.json"
  },
  "given": {
    "mode": "explore",
    "location_id": "river_bend",
    "time_remaining": 9,
    "discovered_clues": [
      "clue_footprint_trail",
      "clue_jar_lid",
      "clue_pink_feather"
    ],
    "revealed_clue_ids": [],
    "history": [
      {
        "sequence": 1,
        "event_type": "start",
        "actor": "system",
        "narration": "Deep in the forest of Arbrum, something is wrong. The Heartwood Trunk is gone!\n\nIt is the glowing heart of the whole forest. Without it, the leaves have stopped their sparkle.\n\nYou are the investigator. Will you find the thief?\n\nFollow the glowing clues. Talk to five friends. Who took the Heartwood Trunk?\n\nTip: type \"notebook\" (or \"n\") to open your case notebook. It holds what you know, who you have met, and every clue you have found. Type \"help\" to see what else you can do.",
        "payload": {}
      },
      {
        "sequence": 2,
        "event_type": "move",
        "actor": "system",
        "narration": "Tall trees stand in a ring. In the middle is a big, empty hole. The ground glows pink and purple. Alexandra, a shiny silver meerkat, bounces over, shaking her pom-poms. \"Oh my! Go ask Sam!\" You can search the little path to the river, the fern patch, or the mossy stump.",
        "payload": {
          "location_id": "heartwood_glade",
          "location_name": "Heartwood Glade",
          "destination": "heartwood_glade"
        }
      },
      {
        "sequence": 3,
        "event_type": "search",
        "actor": "system",
        "narration": "You tickle the curly ferns. Something glints! A tiny glass lid hides in the ferns. Its label says 'Eva's Lab'.",
        "payload": {
          "location_id": "heartwood_glade",
          "location_name": "Heartwood Glade",
          "revealed_clue_ids": [
            "clue_jar_lid"
          ],
          "revealed_clue_id": "clue_jar_lid"
        }
      },
      {
        "sequence": 4,
        "event_type": "talk",
        "actor": "system",
        "narration": "Alexandra spins round, her pom-poms shaking. \"Oh! Isn't it awful? The Heartwood is gone!\" She gasps. \"Grumpy Sam might know something!\"",
        "payload": {
          "character_id": "alexandra",
          "character_name": "Alexandra",
          "location_id": "heartwood_glade"
        }
      },
      {
        "sequence": 5,
        "event_type": "ask",
        "actor": "system",
        "narration": "Alexandra bounces on her toes. \"I was fast asleep in my treehouse all night! A cheerleader needs her sleep before a big race!\"",
        "payload": {
          "player_input": "Where were you at two in the night when the glade flashed pink?",
          "character_id": "alexandra",
          "character_name": "Alexandra",
          "location_id": "heartwood_glade",
          "revealed_clue_ids": []
        }
      },
      {
        "sequence": 6,
        "event_type": "ask",
        "actor": "system",
        "narration": "Alexandra shakes her head fast. \"No! I was asleep in my treehouse. I didn't see anybody at all!\" She grins and twirls a pom-pom.",
        "payload": {
          "player_input": "Did you see or hear anyone near the glade or Glitterleaf Lane in the night?",
          "character_id": "alexandra",
          "character_name": "Alexandra",
          "location_id": "heartwood_glade",
          "revealed_clue_ids": []
        }
      },
      {
        "sequence": 7,
        "event_type": "end_talk",
        "actor": "system",
        "narration": "Alexandra waves her pom-poms. \"Gotta go! Practice is calling!\" She zooms off, glitter trailing behind her. You stay in Heartwood Glade. The pink and purple floor glows around you.",
        "payload": {
          "character_id": "alexandra",
          "character_name": "Alexandra",
          "location_id": "heartwood_glade",
          "location_name": "Heartwood Glade"
        }
      },
      {
        "sequence": 8,
        "event_type": "search",
        "actor": "system",
        "narration": "You brush the soft, mossy stump. Something tickles your hand! A grey pigeon feather lies on the stump. Its tip glows pink.",
        "payload": {
          "location_id": "heartwood_glade",
          "location_name": "Heartwood Glade",
          "revealed_clue_ids": [
            "clue_jar_lid",
            "clue_pink_feather"
          ],
          "revealed_clue_id": "clue_pink_feather"
        }
      },
      {
        "sequence": 9,
        "event_type": "search",
        "actor": "system",
        "narration": "The narrow dirt path twinkles softly. More glowing footprints run down the path to the river. They stop at Sam's tower.",
        "payload": {
          "location_id": "heartwood_glade",
          "location_name": "Heartwood Glade",
          "revealed_clue_ids": [
            "clue_jar_lid",
            "clue_pink_feather",
            "clue_footprint_trail"
          ],
          "revealed_clue_id": "clue_footprint_trail"
        }
      },
      {
        "sequence": 10,
        "event_type": "move",
        "actor": "system",
        "narration": "You arrive at Splashy River Bend. Soft splashes dance over the sand. Glittery leaves rustle overhead.\n\nSam, a huge brown bear in a red lifeguard vest, scowls from his high seat. \"Bah. Questions. Waste of swimming time.\"\n\nSophie peeks out from behind her fluffy tail. Her teal scarf is pulled up tight.\n\nYou can search under the lifeguard tower, in the Lily Pool reeds, or on Sam's lookout seat.",
        "payload": {
          "location_id": "river_bend",
          "location_name": "Splashy River Bend",
          "destination": "river_bend"
        }
      }
    ]
  },
  "action": {
    "type": "search",
    "search_query": "under the lifeguard tower"
  },
  "expect": {
    "revealed_clue_id": "clue_buried_heartwood",
    "input_understood": true
  }
};

// The Midnight Express Bird Heist (repaired blueprint), kid-7, turn 13. Wally's echo, which
// the player held, points to the parcel trolley, whose hatbox is the stolen bird. Haiku
// narrated sacks "too high to reach" and the game was lost.
const underTheTarpaulin: TurnCase = {
  "id": "midnight-express-under-the-tarpaulin",
  "group": "reveal-unlocked",
  "blueprint": {
    "path": "evaluation/runtime/cases/search-reveals/blueprints/midnight-express-repaired.json"
  },
  "given": {
    "mode": "explore",
    "location_id": "platform",
    "time_remaining": 11,
    "discovered_clues": [
      "crate_manifest",
      "mail_satchel",
      "wally_echo"
    ],
    "revealed_clue_ids": [],
    "history": [
      {
        "sequence": 1,
        "event_type": "start",
        "actor": "system",
        "narration": "The Midnight Express puffs into Cobblefield Station at dawn. Steam curls around the platform, and station clocks tick softly.\n\nBut something is wrong. The conductor's leather satchel has vanished. It held the only key to the mail carriage.\n\nWorse, a crate of rare zoo birds is empty. Feathers flutter somewhere along the line!\n\nThe train leaves at sundown. Can you find out who did it, and why?\n\nTip: type \"notebook\" (or \"n\") to open your case notebook. It holds what you know, who you have met, and every clue you have found. Type \"help\" to see what else you can do.",
        "payload": {}
      },
      {
        "sequence": 2,
        "event_type": "move",
        "actor": "system",
        "narration": "Dawn mist curls around Cobblefield Platform like a soft grey scarf. The Midnight Express hisses beside you, its big black engine waiting at the far end. A tall clock ticks above a wooden bench. Pigeons strut past an old gas lamp.\n\nA sturdy woman in a navy conductor's cap hurries over, her brass buttons shining. \"Oh, thank goodness! I'm Mabel Dunmore,\" she says. \"Someone has taken my satchel.\"\n\nNearby, a wiry woman with silver hair hugs a battered journal. She glances away quickly. \"I'm only here for the birds,\" says Ida Quill.",
        "payload": {
          "location_id": "platform",
          "location_name": "Cobblefield Platform",
          "destination": "platform"
        }
      },
      {
        "sequence": 3,
        "event_type": "search",
        "actor": "system",
        "narration": "Steam sighs from the Midnight Express, and pigeons flutter past the gas lamp. Nothing new catches your eye. Perhaps the patch by the mail carriage door holds a secret. Try looking there closely.",
        "payload": {
          "location_id": "platform",
          "location_name": "Cobblefield Platform",
          "revealed_clue_ids": [],
          "revealed_clue_id": null
        }
      },
      {
        "sequence": 4,
        "event_type": "move",
        "actor": "system",
        "narration": "You step into the mail carriage, and the air greets you with straw and feathers. It is warm and a little ticklish on your nose.\n\nIn the middle sits a big wooden crate. Its lid is propped wide open, as if someone left in a hurry. Look closely at **the empty bird crate**.\n\nIn one corner, **the heap of mail sacks** slumps like sleepy cushions. Letters peek out of their open tops.\n\nBehind you, **the sliding door** hangs unlocked. Its padlock dangles open, swaying gently. Something has happened here.",
        "payload": {
          "location_id": "mail_carriage",
          "location_name": "Mail Carriage",
          "destination": "mail_carriage"
        }
      },
      {
        "sequence": 5,
        "event_type": "search",
        "actor": "system",
        "narration": "You lift the lid and peer inside the crate. Straw tickles your fingers. Taped to the underside of the lid is a paper list. It reads: \"Twelve birds for the City Aviary. The last line reads: 'One Silver Mimic Thrush. Copies any whistle it hears.'\"",
        "payload": {
          "location_id": "mail_carriage",
          "location_name": "Mail Carriage",
          "revealed_clue_ids": [
            "crate_manifest"
          ],
          "revealed_clue_id": "crate_manifest"
        }
      },
      {
        "sequence": 6,
        "event_type": "search",
        "actor": "system",
        "narration": "You heave a lumpy sack aside and dig beneath the letters. Your fingers find something smooth and leathery. Under the mail sacks lies Mabel's leather satchel. The mail carriage key is still inside it, shiny and unbent.",
        "payload": {
          "location_id": "mail_carriage",
          "location_name": "Mail Carriage",
          "revealed_clue_ids": [
            "crate_manifest",
            "mail_satchel"
          ],
          "revealed_clue_id": "mail_satchel"
        }
      },
      {
        "sequence": 7,
        "event_type": "move",
        "actor": "system",
        "narration": "You climb into the engine cab. It is warm and smells of coal smoke. Behind an iron door, the firebox glows orange. Brass gauges tick on the wall. A little shelf holds the driver's whistle log. Behind you, the coal tender sits heaped with black lumps.\n\nA broad man turns to greet you. He has a bushy ginger beard, sooty cheeks, and a cap pushed far back. \"Welcome aboard! Isn't she a beauty?\" he booms. His eyes drift to the window. He tugs at his red neckerchief.",
        "payload": {
          "location_id": "engine_cab",
          "location_name": "Engine Cab",
          "destination": "engine_cab"
        }
      },
      {
        "sequence": 8,
        "event_type": "talk",
        "actor": "system",
        "narration": "Coal smoke hangs warm in the cab. Wally wipes his sooty hands on his red neckerchief. \"Morning, friend! Isn't Old Bessie a beauty? Ask me anything about her.\" He grins, but his eyes flick to the gauges.",
        "payload": {
          "character_id": "wally",
          "character_name": "Wally",
          "location_id": "engine_cab"
        }
      },
      {
        "sequence": 9,
        "event_type": "ask",
        "actor": "system",
        "narration": "\"Only Old Bessie's whistles, friend! I'd know them anywhere.\" He taps the little shelf by the gauges. \"My log says two long blasts at Hollow Bend, about ten past three. Then one short toot when the tank was full.\"",
        "payload": {
          "player_input": "did you hear a wissle in the nite? whats in your whistle log??",
          "character_id": "wally",
          "character_name": "Wally",
          "location_id": "engine_cab",
          "revealed_clue_ids": []
        }
      },
      {
        "sequence": 10,
        "event_type": "ask",
        "actor": "system",
        "narration": "\"Yes! At six I gave two short toots to rest Old Bessie. Something whistled right back, from the parcel trolley at the end of the platform!\" He scratches his ginger beard. \"That wasn't my engine, friend. Sneaking about? Not that I saw.\"",
        "payload": {
          "player_input": "did the bird copy ur whistle?? did u see anyone sneak around",
          "character_id": "wally",
          "character_name": "Wally",
          "location_id": "engine_cab",
          "revealed_clue_ids": [
            "wally_echo"
          ]
        }
      },
      {
        "sequence": 11,
        "event_type": "end_talk",
        "actor": "system",
        "narration": "Wally tips his peaked cap. \"Mind how you go, friend! Old Bessie needs me now.\" He turns back to his gauges. You stay put by the warm, glowing firebox, eyes ready to look around.",
        "payload": {
          "character_id": "wally",
          "character_name": "Wally",
          "location_id": "engine_cab",
          "location_name": "Engine Cab"
        }
      },
      {
        "sequence": 12,
        "event_type": "move",
        "actor": "system",
        "narration": "You are back at Cobblefield Platform. Dawn mist still curls along the tracks like a soft grey scarf. The Midnight Express hisses beside you, its big black engine waiting at the far end. A tall clock ticks above the wooden bench. Pigeons strut past the old gas lamp.\n\nMabel Dunmore straightens her navy cap, her brass buttons shining. \"You're back! I still can't find my satchel,\" she says.\n\nNearby, Ida Quill hugs her battered journal. She glances away quickly.\n\nYou could search the bench under the station clock, the mail carriage door, the old gas lamp, or under the parcel trolley tarpaulin.",
        "payload": {
          "location_id": "platform",
          "location_name": "Cobblefield Platform",
          "destination": "platform"
        }
      }
    ]
  },
  "action": {
    "type": "search",
    "search_query": "under the parcel trolley tarpaulin"
  },
  "expect": {
    "revealed_clue_id": "trolley_hatbox",
    "input_understood": true
  }
};

export default [underTheTower, underTheTarpaulin];
