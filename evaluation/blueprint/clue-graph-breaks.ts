/**
 * Broken copies of the two hand-written clue-graph cases, for scoring the
 * clue-graph judges: each judge must pass a story and fail its broken copy
 * before it is trusted (`evaluation/README.md`). A copy breaks one thing per
 * judge, so a judge's fail can be traced to its break, and each break leaves
 * the case valid, so only a judge can catch it.
 *
 * A break sets one value in the case, at a path of keys and indexes.
 *
 *   node evaluation/blueprint/clue-graph-breaks.ts <case file> <out file>
 *
 * writes the broken copy of a story; its `metadata.id` picks the breaks.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface Break {
  /** The judge the break is for. */
  judge: "cg_soundness" | "cg_truth_agreement" | "cg_character_grounding" | "cg_step_sense";
  at: readonly (string | number)[];
  value: unknown;
  /** What is now wrong, for a reader of the judge's verdict. */
  what: string;
}

/** The breaks of each story, by its `metadata.id`. */
export const CLUE_GRAPH_BREAKS: Readonly<Record<string, readonly Break[]>> = {
  "dragon-crown": [
    {
      judge: "cg_soundness",
      at: ["conclusions", "nina_cleared", "rule"],
      value: { all: ["clue_script_cards"] },
      what: "Nina is cleared on her script cards alone, which show she practised behind the shed at some time, not that she was there, watched, while the crown was squashed.",
    },
    {
      judge: "cg_truth_agreement",
      at: ["clues", "clue_pike_saw_bundle", "fact"],
      value:
        "Mr. Pike says that at about one o'clock he saw young Leo through the art room window. Leo tucked a bundle wrapped in his apron behind the big paper dragon, and he looked very guilty.",
      what: "A true statement puts Leo hiding the crown at one o'clock; the timeline has it at 12:15, before Mrs. Abara found it gone at 12:45.",
    },
    {
      judge: "cg_character_grounding",
      at: ["characters", "leo", "personality"],
      value:
        "Calm, steady and fearless. He never panics, always owns up straight away, and would never let a friend take the blame.",
      what: "The culprit's personality forbids what he did: he panicked, hid the crown and blamed Nina.",
    },
    {
      judge: "cg_step_sense",
      at: ["clues", "pike_roof", "fact"],
      value: "Mr. Pike says he has been up on the bike-shed roof since twelve, mending the felt.",
      what: "Mr. Pike's first words no longer mention the art room windows, so nothing leads a child to ask him about the art room window.",
    },
  ],
  "greenhouse-prizewinner": [
    {
      judge: "cg_soundness",
      at: ["conclusions", "nobody_broke_in", "rule"],
      value: { all: ["clue_boot_prints"] },
      what: "Nobody broke in is concluded from boot prints outside the broken window, which suggest the opposite.",
    },
    {
      judge: "cg_truth_agreement",
      at: ["characters", "hale", "knows", 3],
      value: {
        fact: "Ms. Hale took Toby off the last watering shifts after he forgot to lock up on Monday, and told him not to go in without a grown-up. Toby shouted, 'She's MY pumpkin!'",
      },
      what: "Ms. Hale shares, whenever asked, the fact of her gated clue clue_hale_toby_upset, which is also the whole of the motive conclusion.",
    },
    {
      judge: "cg_character_grounding",
      at: ["characters", "thorne", "appearance", 1],
      value: "He wears small, neat clogs, and has never owned a pair of boots.",
      what: "Mr. Thorne's appearance contradicts the huge boot prints he left, which he admits are his.",
    },
    {
      judge: "cg_step_sense",
      at: ["clues", "clue_dobbs_crash_time", "reached", "about"],
      value: "the robin's nest in the hedge",
      what: "The crash time comes only by asking Mr. Dobbs about a robin's nest, which nothing the player holds mentions.",
    },
  ],
};

function setAt(target: unknown, at: readonly (string | number)[], value: unknown): void {
  let node = target as Record<string | number, unknown>;
  for (const key of at.slice(0, -1)) {
    if (node === null || typeof node !== "object" || !Object.hasOwn(node, key)) {
      throw new Error(`break path ${at.join(".")} has no ${String(key)}`);
    }
    node = node[key] as Record<string | number, unknown>;
  }
  node[at[at.length - 1]] = value;
}

/** The broken copy of a story: the case with every break of its `metadata.id` applied. */
export function brokenCopy(story: unknown): unknown {
  const id = (story as { metadata?: { id?: unknown } } | null)?.metadata?.id;
  const breaks = typeof id === "string" ? CLUE_GRAPH_BREAKS[id] : undefined;
  if (!breaks) throw new Error(`no breaks for case ${JSON.stringify(id)}: known ${Object.keys(CLUE_GRAPH_BREAKS).join(", ")}`);
  // The id and title stay as they are: a judge must not be told it reads a broken copy.
  const copy = structuredClone(story);
  for (const entry of breaks) setAt(copy, entry.at, entry.value);
  return copy;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    process.stderr.write("usage: node evaluation/blueprint/clue-graph-breaks.ts <case file> <out file>\n");
    process.exit(3);
  }
  const copy = brokenCopy(JSON.parse(fs.readFileSync(input, "utf8")));
  fs.writeFileSync(output, `${JSON.stringify(copy, null, 2)}\n`);
  process.stdout.write(`wrote ${output}\n`);
}
