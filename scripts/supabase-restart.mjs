import path from "node:path";
import {
  npxBin,
  loadEnvFile,
  runCommand,
  getRecordedMode,
  writeRecordedMode,
} from "./supabase-utils.mjs";

const rootDir = process.cwd();
const recordedMode = await getRecordedMode(rootDir);

if (!recordedMode) {
  console.error(
    "No recorded AI mode found (.supabase-ai-mode). " +
      "Start supabase first via: npm run dev, npm run dev:ai:free, or npm run dev:ai:paid",
  );
  process.exit(1);
}

const baseVars = await loadEnvFile(path.join(rootDir, ".env.local"), false);

let modeVars;
if (recordedMode === "mock") {
  modeVars = { AI_PROVIDER: "mock", AI_MODEL: "mock/runtime-default" };
} else {
  modeVars = await loadEnvFile(
    path.join(rootDir, `.env.ai.${recordedMode}.local`),
    true,
  );
}

const env = { ...baseVars, ...modeVars, ...process.env };

// For mock mode, ensure AI vars are not overridden by an inherited process.env
if (recordedMode === "mock") {
  env.AI_PROVIDER = "mock";
  env.AI_MODEL = "mock/runtime-default";
}

console.log(`Restarting supabase in "${recordedMode}" AI mode...`);
runCommand(npxBin, ["supabase", "stop"], env, true);
runCommand(npxBin, ["supabase", "start"], env);
await writeRecordedMode(rootDir, recordedMode);
console.log("Done.");
