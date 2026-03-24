import { existsSync } from "node:fs";
import { getBaseEnvPath } from "../scripts/local-config.mjs";

const envPath = getBaseEnvPath(process.cwd(), process.env);

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}
