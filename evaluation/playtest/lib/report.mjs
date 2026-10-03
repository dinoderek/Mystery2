// A run folder as one page: every game's transcript, with each judge finding
// pinned beside the turn it cites.
//
//   report.html   written into the run folder by eval:playtest, and by
//                 eval:playtest:report for a run that is already on disk
//
// The page is a single self-contained file (report-template.html with the
// run's data inlined), so it opens straight from disk or can be shared as is.
//
// Turns come from the run's game.db, not transcript.md: each event carries the
// sequence number the judges cite and the clue ids it recorded. The
// investigator's input and plan for each event come from steps.jsonl, matched
// by the narration the step got back. Lines the game never sent (parser hints,
// failed calls) have no event and are shown where they were typed.

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

import Database from "better-sqlite3";

const TEMPLATE = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "report-template.html");

function readJson(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

function readJsonLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function parseJson(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

function gameNumbers(runDir) {
  return fs.readdirSync(runDir)
    .map((name) => /^game-(\d+)$/.exec(name))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b);
}

/**
 * The blueprint behind a run: from a game's trace.json when the run was
 * graded, else the repo's blueprints/ by id. Null when neither has it; clues
 * then show the text their event recorded, or only their id.
 */
function findBlueprint(runDir, numbers, blueprintId, repoRoot) {
  for (const number of numbers) {
    const trace = readJson(path.join(runDir, `game-${number}`, "trace.json"));
    if (trace?.blueprint) return trace.blueprint;
  }
  const dir = path.join(repoRoot, "blueprints");
  if (!blueprintId || !fs.existsSync(dir)) return null;
  for (const name of fs.readdirSync(dir).filter((file) => file.endsWith(".json"))) {
    const blueprint = parseJson(fs.readFileSync(path.join(dir, name), "utf8"), null);
    if (blueprint?.id === blueprintId) return blueprint;
  }
  return null;
}

function clueTexts(blueprint) {
  const texts = {};
  const add = (clues) => {
    for (const clue of clues ?? []) texts[clue.id] = clue.text;
  };
  for (const location of blueprint?.world?.locations ?? []) {
    add(location.clues);
    for (const sub of location.sub_locations ?? []) add(sub.clues);
  }
  for (const character of blueprint?.world?.characters ?? []) add(character.clues);
  return texts;
}

function readEvents(db, gameId) {
  return db
    .prepare(
      "select sequence, event_type, payload, narration_parts from game_events where session_id = ? order by sequence",
    )
    .all(gameId)
    .map((row) => ({
      sequence: row.sequence,
      type: row.event_type,
      payload: parseJson(row.payload, {}),
      parts: parseJson(row.narration_parts, []),
    }));
}

/** Every finding the grades hold: each judge's, and each mechanical violation. */
function readFindings(result) {
  if (!result) return [];
  const judged = (result.dimensions ?? []).flatMap((dimension) =>
    (dimension.judge?.raw?.findings ?? []).map((finding) => ({
      check: dimension.id,
      sequence: finding.sequence,
      severity: finding.severity,
      kind: finding.kind ?? null,
      quote: typeof finding.quote === "string" ? finding.quote : null,
      why: finding.why ?? "",
    }))
  );
  const mechanical = (result.mechanical ?? []).flatMap((check) =>
    (check.details?.violations ?? []).map((violation) => ({
      check: check.id,
      sequence: violation.sequence,
      severity: "mechanical",
      kind: violation.reason,
      quote: null,
      why: Object.entries(violation)
        .filter(([key]) => key !== "sequence" && key !== "reason")
        .map(([key, value]) => `${key}: ${value}`)
        .join(", "),
    }))
  );
  return [...mechanical, ...judged];
}

const firstText = (parts) => (parts?.[0]?.text ?? "").trim();

function stepRow(step) {
  return {
    input: step.input,
    plan: step.plan ?? null,
    // A line the player typed mid-conversation that reads like a command is
    // still a question to the character: talk mode only knows `bye`.
    asDialogue:
      step.mode_before === "talk" &&
      step.action?.endpoint === "game-ask" &&
      /^(accuse|go to|move to|search|talk to|speak (to|with))\b/i.test(step.input.trim()),
  };
}

/**
 * Lays the game's events out in order, each with the input and plan that led
 * to it. Steps that never reached the game (a parser hint, a failed call) get
 * a row of their own where they were typed.
 */
function buildTurns(events, steps, clueText, readability) {
  const grades = new Map((readability?.narrations ?? []).map((entry) => [entry.sequence, entry]));
  const turns = [];
  let next = 0;

  const pushEvent = (event, step) => {
    const grade = grades.get(event.sequence);
    const ids = event.type === "search"
      ? (event.payload.revealed_clue_id ? [event.payload.revealed_clue_id] : [])
      : (event.payload.revealed_clue_ids ?? []);
    turns.push({
      seq: event.sequence,
      type: event.type,
      ...(step ? stepRow(step) : { input: null, plan: null, asDialogue: false }),
      turnsLeft: event.payload.diagnostics?.time_after ?? null,
      parts: event.parts.map((part) => ({
        speaker: part.speaker?.label ?? "Narrator",
        character: part.speaker?.kind === "character",
        text: part.text ?? "",
      })),
      clues: ids.map((id) => ({
        id,
        text: (id === event.payload.revealed_clue_id ? event.payload.revealed_clue_text : null) ??
          clueText[id] ?? null,
      })),
      grade: grade ? { value: grade.grade, pass: grade.status === "pass" } : null,
    });
  };

  for (const step of steps) {
    // The first unclaimed event with the narration this step got back: mock
    // narration repeats, so the search starts after the last match.
    const text = step.response?.ok ? firstText(step.response.body?.narration_parts) : "";
    const found = text ? events.slice(next).findIndex((event) => firstText(event.parts) === text) : -1;
    if (found !== -1) {
      const at = next + found;
      while (next < at) pushEvent(events[next++], null);
      pushEvent(events[next++], step);
      continue;
    }
    const note = step.action?.kind === "feedback"
      ? { kind: "feedback", text: step.action.text }
      : step.action?.kind === "quit"
      ? { kind: "feedback", text: "The investigator stopped playing." }
      : { kind: "error", text: `Request failed (${step.response?.status ?? "no response"})` };
    turns.push({ seq: null, type: note.kind, ...stepRow(step), turnsLeft: step.time_after ?? null, parts: [], clues: [], grade: null, note });
  }
  while (next < events.length) pushEvent(events[next++], null);
  return turns;
}

/** Everything the page shows, read from a run folder. */
export function buildReportData(runDir, { repoRoot = process.cwd() } = {}) {
  const numbers = gameNumbers(runDir);
  const runSummary = readJson(path.join(runDir, "summary.json")) ?? [];
  const summaries = new Map(numbers.map((n) => [n, readJson(path.join(runDir, `game-${n}`, "summary.json"))]));
  const first = [...summaries.values()].find(Boolean);
  const blueprint = findBlueprint(runDir, numbers, first?.blueprint?.id, repoRoot);
  const clueText = clueTexts(blueprint);

  const dbFile = path.join(runDir, "game.db");
  const db = fs.existsSync(dbFile) ? new Database(dbFile, { readonly: true, fileMustExist: true }) : null;
  try {
    const games = numbers.map((number) => {
      const dir = path.join(runDir, `game-${number}`);
      const summary = summaries.get(number);
      const events = db && summary ? readEvents(db, summary.game_id) : [];
      const steps = readJsonLines(path.join(dir, "steps.jsonl"));
      const grades = summary?.grades ?? null;
      return {
        number,
        gameId: summary?.game_id ?? null,
        outcome: summary?.outcome ?? null,
        stopReason: summary?.stop_reason ?? null,
        error: summary?.error ?? grades?.error ?? null,
        replayOf: summary?.replay_of ?? null,
        turnsUsed: summary?.turns_used ?? null,
        timeBudget: summary?.time_budget ?? null,
        steps: summary?.steps ?? steps.length,
        cluesFound: summary?.clues_found ?? null,
        cluesTotal: summary?.clues_total ?? null,
        cost: {
          narrator: summary?.narrator_cost_usd ?? null,
          investigator: summary?.investigator_cost_usd ?? null,
          judges: grades?.judge_cost_usd ?? null,
        },
        wallSeconds: summary?.wall_seconds ?? null,
        judges: grades?.judges ?? null,
        mechanical: grades?.mechanical ?? null,
        readability: grades?.readability ?? null,
        findings: readFindings(readJson(path.join(dir, "result.json"))),
        turns: buildTurns(events, steps, clueText, readJson(path.join(dir, "readability.json"))),
      };
    });

    // Games that never started have no folder; the run summary names them.
    const failed = runSummary
      .filter((entry) => entry && entry.error && entry.game && !numbers.includes(entry.game))
      .map((entry) => ({ number: entry.game, error: entry.error }));

    return {
      run: path.basename(path.resolve(runDir)),
      title: first?.blueprint?.title ?? blueprint?.metadata?.title ?? "Playtest",
      persona: first?.persona ?? null,
      narratorModel: first?.narrator_model ?? null,
      investigatorModel: first?.investigator_model ?? null,
      targetAge: blueprint?.metadata?.target_age ?? null,
      games,
      failed,
    };
  } finally {
    db?.close();
  }
}

/** The page for a run's data: the template with the data inlined. */
export function renderReport(data) {
  // Inlined in a <script> element, so no "<" may survive to close it early.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const title = `${data.title} Playtest`.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  return fs.readFileSync(TEMPLATE, "utf8")
    .replace("__REPORT_TITLE__", () => title)
    .replace("__REPORT_DATA__", () => json);
}

/** Writes <run>/report.html and returns its path. */
export function writeReport(runDir, options = {}) {
  const file = path.join(runDir, "report.html");
  fs.writeFileSync(file, renderReport(buildReportData(runDir, options)));
  return file;
}
