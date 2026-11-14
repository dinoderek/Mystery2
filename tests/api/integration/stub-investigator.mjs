// A stand-in for the investigator's wrapper, so a self-play run needs no model.
//
// Usage (as the `investigator` binding): node stub-investigator.mjs <system file> <user file>
//
// It reads the player's view and types the next line of a fixed game, chosen by
// how many lines the player has typed so far, then answers in the Claude CLI's
// JSON envelope, `structured_output` and a cost included. The model it reports
// is EVAL_MODEL, which the model runner sets from the binding.
//
// STUB_INVESTIGATOR_MODE: `crash` exits non-zero (the runner retries, then the
// game stops), `empty` answers with no input.

import fs from "node:fs";
import process from "node:process";

const INPUTS = [
  "search",
  "talk to alice",
  "Where were you last night?",
  "bye",
  "accuse",
  "Alice did it, the crumbs lead to her.",
  "Alice took the cookies: the crumbs and the empty jar both point to her.",
];

const mode = process.env.STUB_INVESTIGATOR_MODE ?? "ok";
if (mode === "crash") {
  process.stderr.write("stub investigator crashed\n");
  process.exit(1);
}

const view = fs.readFileSync(process.argv[3], "utf8");
const story = view.split("== STORY SO FAR ==")[1] ?? "";
const typed = story.split("\n").filter((line) => line.startsWith("> ")).length;
const input = mode === "empty" ? "" : (INPUTS[typed] ?? "quit");

process.stdout.write(
  JSON.stringify({
    type: "result",
    is_error: false,
    result: "",
    structured_output: { plan: `step ${typed + 1}`, input },
    total_cost_usd: 0.01,
    modelUsage: { [process.env.EVAL_MODEL ?? "unbound"]: { inputTokens: 100, outputTokens: 5 } },
  }),
);
