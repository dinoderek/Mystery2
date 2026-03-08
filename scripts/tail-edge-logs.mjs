import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

function parseTailArg(argv) {
  const idx = argv.findIndex((arg) => arg === "--tail");
  if (idx === -1) return "200";
  const value = argv[idx + 1];
  if (!value) return "200";
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return "200";
  return String(parsed);
}

function resolveProjectId() {
  const configPath = path.join(process.cwd(), "supabase", "config.toml");
  if (!fs.existsSync(configPath)) {
    throw new Error("supabase/config.toml not found. Run from repository root.");
  }

  const content = fs.readFileSync(configPath, "utf8");
  const match = content.match(/^project_id\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error("Unable to read project_id from supabase/config.toml");
  }

  return match[1];
}

function resolveEdgeContainerName(projectId) {
  const result = spawnSync(
    "docker",
    [
      "ps",
      "--filter",
      `label=com.supabase.cli.project=${projectId}`,
      "--format",
      "{{.Names}}",
    ],
    { encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout).trim() || "docker ps failed");
  }

  const names = result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  const edgeContainer = names.find((name) => name.startsWith("supabase_edge_runtime_"));
  if (!edgeContainer) {
    throw new Error(
      `No edge runtime container found for Supabase project "${projectId}". Start Supabase first with: npx supabase start`,
    );
  }

  return edgeContainer;
}

const tailLines = parseTailArg(process.argv.slice(2));

try {
  const projectId = resolveProjectId();
  const containerName = resolveEdgeContainerName(projectId);

  console.log(
    `Tailing edge runtime logs from ${containerName} (project=${projectId}, tail=${tailLines})...`,
  );

  const child = spawn("docker", ["logs", "--tail", tailLines, "-f", containerName], {
    stdio: "inherit",
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
