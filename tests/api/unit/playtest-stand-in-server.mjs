// A stand-in for the game server in the playtest recording tests: it prints
// to both streams, writes a line to the call log it was given, and then
// either exits (`STAND_IN_MODE=exit`) or waits for a signal, which it reports
// and exits on with status 7. Not a .test file, so vitest never collects it.

import fs from "node:fs";
import process from "node:process";
import { setInterval } from "node:timers";

process.stdout.write(`stand-in stdout FORCE_COLOR=${process.env.FORCE_COLOR}\n`);
process.stderr.write("stand-in stderr \u001b[31mred\u001b[39m\n");
fs.appendFileSync(process.env.AI_CALL_LOG, `${JSON.stringify({ call: "stand-in" })}\n`);

if (process.env.STAND_IN_MODE === "exit") {
  process.exitCode = 3;
} else {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      process.stdout.write(`stand-in got ${signal}\n`);
      process.exit(7);
    });
  }
  setInterval(() => {}, 1000);
  process.stdout.write("stand-in ready\n");
}
