#!/usr/bin/env node
// Generate deterministic runtime-eval cases from a collected game-master trace
// (e.g. ~/mysteryevals/traces/trace-*.json, produced by evaluation/trace/extract.mjs).
//
// A trace bundles the full blueprint, the final session, and the ordered event
// stream. Every event's payload self-describes the exact state it was generated
// from (diagnostics.mode, diagnostics.time_before, location_id, character_id,
// player_input, revealed_clue_ids). So each target event becomes one case:
//   given  = that pre-event state + ALL prior events as fixed history
//   action = the event itself (ask/talk/move/search)
// which is exactly the deterministic single-event shape run.mjs consumes.
//
// Usage:
//   node evaluation/runtime/cases-from-trace.mjs <trace.json> [options]
//
// Options:
//   --out <dir>     output dir (default: evaluation/runtime/cases/from-traces)
//   --types <list>  event types to turn into cases (default: ask,talk)
//   --max <n>       cap cases per type, sampled evenly across the session (default: 3)
//   --judges <list> judges for the generated cases (default: flesch)

import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t.startsWith("--")) { args[t.slice(2)] = argv[i + 1]; i += 1; } else { args._.push(t); }
  }
  return args;
}

// Trim a trace event's payload to the fields the runtime context builder reads
// for history (keeps generated cases readable without losing fidelity).
function historyPayload(payload) {
  const keep = {};
  for (const k of [
    "player_input", "character_id", "character_name", "location_id",
    "location_name", "destination", "revealed_clue_ids", "revealed_clue_id",
  ]) {
    if (payload?.[k] !== undefined) keep[k] = payload[k];
  }
  return keep;
}

function toFragment(event) {
  return {
    sequence: event.sequence,
    event_type: event.event_type, // keep verbatim ("ask"/"talk"/"end_talk"/...)
    actor: event.actor ?? "system",
    narration: event.narration ?? "",
    payload: historyPayload(event.payload ?? {}),
  };
}

// Build the `action` for a target event, or null if the type isn't supported.
function actionForEvent(event) {
  const p = event.payload ?? {};
  switch (event.event_type) {
    case "ask": return { type: "ask", player_input: p.player_input ?? "" };
    case "talk": return { type: "talk", character_id: p.character_id };
    case "move": return { type: "move", destination: p.destination };
    case "search": return { type: "search" };
    default: return null;
  }
}

// Pick up to `max` items, evenly spaced across the array (first..last).
function sampleEvenly(items, max) {
  if (items.length <= max) return items;
  const out = [];
  for (let i = 0; i < max; i += 1) {
    out.push(items[Math.round((i * (items.length - 1)) / (max - 1))]);
  }
  return [...new Set(out)];
}

function buildCase(event, priorEvents, blueprintPath, judges) {
  const p = event.payload ?? {};
  const diag = p.diagnostics ?? {};
  const given = {
    mode: diag.mode ?? "explore",
    location_id: p.location_id,
    ...(p.character_id ? { talk_character_id: p.character_id } : {}),
    time_remaining: diag.time_before ?? p.time_remaining ?? 0,
    history: priorEvents.map(toFragment),
  };
  return {
    id: `s${event.sequence}-${event.event_type}`,
    blueprint: { path: blueprintPath },
    given,
    action: actionForEvent(event),
    judges,
    judgeConfig: { flesch: { tolerance: 2 } },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tracePath = args._[0];
  if (!tracePath) {
    console.error("Usage: node evaluation/runtime/cases-from-trace.mjs <trace.json> [--out dir] [--types ask,talk] [--max n]");
    process.exit(1);
  }
  const types = (args.types ?? "ask,talk").split(",").map((s) => s.trim());
  const max = Number.parseInt(args.max ?? "3", 10);
  const judges = (args.judges ?? "flesch").split(",").map((s) => s.trim());
  const outDir = path.resolve(process.cwd(), args.out ?? path.join("evaluation", "runtime", "cases", "from-traces"));

  const trace = JSON.parse(await fs.readFile(path.resolve(process.cwd(), tracePath), "utf-8"));
  if (!trace.blueprint?.id || !Array.isArray(trace.events)) {
    throw new Error("Not a trace file: expected { blueprint: { id }, events: [...] }");
  }

  // Persist the blueprint so cases can reference it by path (and the endpoint
  // backend can seed it into storage).
  const blueprintsDir = path.join(outDir, "blueprints");
  await fs.mkdir(blueprintsDir, { recursive: true });
  const blueprintAbs = path.join(blueprintsDir, `${trace.blueprint.id}.json`);
  await fs.writeFile(blueprintAbs, JSON.stringify(trace.blueprint, null, 2) + "\n");
  const blueprintPath = path.relative(process.cwd(), blueprintAbs);

  const events = [...trace.events].sort((a, b) => a.sequence - b.sequence);
  const cases = [];
  for (const type of types) {
    const targets = sampleEvenly(events.filter((e) => e.event_type === type), max);
    for (const event of targets) {
      const action = actionForEvent(event);
      if (!action) continue;
      const prior = events.filter((e) => e.sequence < event.sequence);
      cases.push(buildCase(event, prior, blueprintPath, judges));
    }
  }
  cases.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

  const traceId = path.basename(tracePath).replace(/\.json$/, "");
  const outFile = path.join(outDir, `${traceId}.cases.mjs`);
  const header =
    `// Generated by cases-from-trace.mjs from ${path.basename(tracePath)}.\n` +
    `// Blueprint: ${trace.blueprint.metadata?.title ?? trace.blueprint.id} (target_age ${trace.blueprint.metadata?.target_age}).\n` +
    `// Each case is ONE deterministic event with the exact prior history fixed.\n` +
    `// ask/talk run on both backends; move/search are endpoint-only.\n`;
  await fs.writeFile(outFile, `${header}export default ${JSON.stringify(cases, null, 2)};\n`);

  console.log(`[cases-from-trace] ${cases.length} case(s) -> ${path.relative(process.cwd(), outFile)}`);
  console.log(`[cases-from-trace] blueprint -> ${blueprintPath} (target_age ${trace.blueprint.metadata?.target_age})`);
  for (const c of cases) {
    const detail = c.action.type === "ask" ? JSON.stringify(c.action.player_input)
      : c.action.type === "talk" ? c.action.character_id
      : c.action.type === "move" ? `-> ${c.action.destination}` : "";
    console.log(`  ${c.id.padEnd(14)} history=${String(c.given.history.length).padStart(2)}  ${detail}`);
  }
}

main().catch((err) => {
  console.error(`[cases-from-trace] error: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
