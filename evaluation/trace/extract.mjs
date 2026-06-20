import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import url from "node:url";

import { createSupabaseTraceSource, extractSessionTrace } from "./lib/datasource.mjs";

function parseArgs(argv) {
  const args = { session: null, out: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--session") args.session = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function usage() {
  return `Usage: node evaluation/trace/extract.mjs --session <id> [--out <file>]

Pulls a played session out of Supabase (session snapshot + ordered event log +
driving blueprint + non-secret AI-profile metadata) and writes a self-contained
raw trace artifact. That artifact is the input to the trace-evaluation pipeline
(node evaluation/trace/run.mjs --trace <file>).

Required:
  --session <id>   The game_sessions id to extract.

Options:
  --out <file>     Where to write the raw trace JSON. Defaults to
                   ./trace-<session>.json in the current directory. Use "-" to
                   write to stdout.

Environment:
  SERVICE_ROLE_KEY   Required. Supabase service-role key.
  SUPABASE_URL / API_URL   Optional. Supabase URL (auto-resolved in worktrees).
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.session) {
    process.stdout.write(usage());
    process.exit(args.help ? 0 : 1);
  }

  const source = createSupabaseTraceSource();
  const trace = await extractSessionTrace(source, args.session);
  const json = JSON.stringify(trace, null, 2);

  if (args.out === "-") {
    process.stdout.write(json + "\n");
    return;
  }
  const outPath = path.resolve(args.out ?? `trace-${args.session}.json`);
  await fs.writeFile(outPath, json);
  process.stdout.write(
    `[trace-extract] wrote ${trace.events.length} events for session ${args.session} → ${outPath}\n`,
  );
}

const isMain = import.meta.url === url.pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`[trace-extract] error: ${err.message}\n`);
    process.exit(1);
  });
}
