// The launcher's recording path, as `scripts/dev.mjs` runs it on `prod`, with
// the stand-in server in place of the game. The tests run it as its own
// process, so a signal they send it is one the launcher receives. Not a .test
// file, so vitest never collects it.

import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveDatabaseName } from "../../../lib/database-target.mjs";
import { beginRecording, planRecording, runRecorded } from "../../../scripts/lib/playtest-recording.mjs";
import { startServer } from "../../../scripts/lib/process.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const env = process.env;

const recording = planRecording({ root, env, databaseName: resolveDatabaseName(root, env), date: env.PLAYTEST_DATE });
if (!recording) throw new Error("the driver is for a run that records");
beginRecording(recording, { root, env });
process.exitCode = await runRecorded(recording, (serverEnv, serverLog) =>
  startServer({ command: process.execPath, args: [path.join(here, "playtest-stand-in-server.mjs")], env: serverEnv, stdin: "ignore", serverLog }).exit,
);
