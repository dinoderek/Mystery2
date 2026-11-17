/**
 * The labelling page's HTML. Every page is rendered by the server and every
 * save is a form post, so the browser needs no script beyond the keyboard glue
 * at the bottom, which adds and removes the form's fault rows and opens its
 * menus (`keys.ts` decides what a key means). Each fault is a row with its own
 * kind, severity and note. The ground truth and a speaking character's profile
 * open over the page, so they push nothing down. On a touch screen the save
 * stays at the bottom of the screen and the keys are not shown.
 */

import { ADD_KEY, CLEAN_KEY, KEYED_KINDS, KIND_KEYS, NOTE_KEY, PREVIOUS_KEY, REMOVE_KEY, SEVERITY_KEYS, TRUTH_KEY } from "./keys.ts";
import { tallyByJudge } from "./disagreements.ts";
import type { Disagreement, JudgeTally, VerdictAtTurn } from "./disagreements.ts";
import { describeJudgeKind } from "./judge-kinds.ts";
import type { StoredFinding } from "../lib/truth/schemas.ts";
import type { CharacterView, ClueView, FormFault, FormState, TurnView } from "./turns.ts";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

const STYLE = `
:root { color-scheme: light dark; --bg: #fbfaf7; --fg: #1d1c1a; --muted: #6b675f; --line: #d9d4c9; --card: #fff; --accent: #2f5d50; --bad: #a3261c; }
@media (prefers-color-scheme: dark) { :root { --bg: #17171a; --fg: #ecebe6; --muted: #9a978f; --line: #35343a; --card: #202024; --accent: #7fc4ad; --bad: #ff8f84; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 16px 12px 32px; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; }
main { position: relative; max-width: 46rem; margin: 0 auto; }
header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; margin: 0 0 12px; font-size: .9rem; }
h1 { font-size: 1.05rem; margin: 0 0 16px; font-weight: 600; }
h2 { font-size: .8rem; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin: 0 0 4px; }
h2.name { font-size: 1rem; letter-spacing: 0; text-transform: none; color: var(--fg); }
summary h2 { display: inline; }
section { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px 16px; margin: 0 0 12px; }
p, ul, ol { margin: 0; } ul, ol { padding-left: 1.2rem; } section p + p { margin-top: 4px; }
.narration { white-space: pre-wrap; }
.muted { color: var(--muted); } .error { color: var(--bad); font-weight: 600; }
summary { cursor: pointer; }
.title { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin: 0 0 12px; }
.title h1 { margin: 0; }
.command code { font: .85rem ui-monospace, monospace; border: 1px solid var(--line); border-radius: 4px; padding: 0 6px; }
.menu > summary { display: inline-block; min-height: 44px; padding: 8px 14px; border: 1px solid var(--accent); border-radius: 6px; color: var(--accent); font-size: .9rem; list-style: none; }
.menu > summary::-webkit-details-marker { display: none; }
.menu[open] > summary { background: var(--accent); color: var(--bg); }
.panel { position: absolute; left: 0; right: 0; z-index: 10; max-height: 75vh; overflow: auto; margin-top: 4px; padding: 12px 16px; background: var(--card); border: 1px solid var(--accent); border-radius: 8px; box-shadow: 0 8px 24px rgb(0 0 0 / 25%); }
.panel p + p, .panel ul + p, .panel details { margin-top: 6px; }
.fold > summary { color: var(--accent); }
.fault { min-width: 0; display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr) auto; gap: 8px; margin: 0 0 8px; padding: 8px; border: 1px solid var(--line); border-radius: 6px; }
.fault.current { border-color: var(--accent); }
.fault input { grid-column: 1 / -1; }
.faults:empty::before { content: "No fault: saved as it is, the turn is clean."; color: var(--muted); }
input[type=text], input[type=search], input[type=date], select { width: 100%; min-height: 44px; padding: 8px; font: inherit; color: inherit; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; }
.filter { display: grid; gap: 8px; }
.filter .more { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: 8px 12px; margin-top: 8px; }
.filter label { display: block; font-size: .85rem; color: var(--muted); }
.actions { position: sticky; bottom: 0; display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 0; background: var(--card); }
button, a.button { display: inline-block; font: inherit; min-height: 44px; padding: 8px 16px; border: 1px solid var(--accent); background: var(--accent); color: var(--bg); border-radius: 6px; cursor: pointer; text-decoration: none; }
button.quiet, a.button { background: transparent; color: var(--accent); }
.links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
kbd { font: .85em ui-monospace, monospace; border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; }
@media (hover: none) { kbd, .keys { display: none; } }
a { color: var(--accent); } table { border-collapse: collapse; width: 100%; } td, th { text-align: left; padding: 2px 8px 2px 0; vertical-align: top; }
.judge { margin: 6px 0 0; } .judge > summary { font-weight: 600; }
.runs, .findings { padding-left: 1.2rem; } .runs > li + li, .findings > li + li { margin-top: 6px; }
blockquote { margin: 4px 0; padding: 0 0 0 8px; border-left: 3px solid var(--line); font-style: italic; overflow-wrap: anywhere; }
`;

/** The header every page carries: back to the games, and who is labelling. */
function headerHtml(who: string | null): string {
  const name = who === null ? `<a href="/name">choose your name</a>` : `labelling as <b>${escapeHtml(who)}</b> (<a href="/name">change</a>)`;
  return `<header><a href="/">All games</a><span>${name}</span></header>`;
}

export function shell(title: string, body: string, who: string | null, script = ""): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body><main>${headerHtml(who)}${body}</main>${script}</body></html>`;
}

export interface TurnPage {
  game: string;
  /** What the pass is called, such as "pass 1". */
  phaseName: string;
  /** Where the pass lives: its turns are `<base>/turn/<n>`. */
  base: string;
  who: string;
  view: TurnView;
  form: FormState;
  /** Who gave the turn's latest label, when, and in which pass; null before it has one. */
  labelled: string | null;
  /** Shown when the last save failed. */
  error: string | null;
  previous: number | null;
  next: number | null;
  /** The second pass's disagreements on this turn; empty in the first. */
  disagreements: readonly Disagreement[];
}

function clueItems(clues: readonly ClueView[]): string {
  const items = clues.map((clue) => `<li>${escapeHtml(clue.id)}: ${clue.text === null ? `<span class="muted">(no such clue in the blueprint)</span>` : escapeHtml(clue.text)}</li>`);
  return `<ul>${items.join("")}</ul>`;
}

function cluesHtml(view: TurnView): string {
  return view.clues.length === 0 ? `<p class="muted">none</p>` : clueItems(view.clues);
}

/** A labelled line, left out when the blueprint has nothing for it. */
function line(name: string, value: string | null): string {
  return value === null ? "" : `<p><b>${name}:</b> ${escapeHtml(value)}</p>`;
}

/** A labelled list, left out when it is empty. */
function list(name: string, items: readonly string[]): string {
  return items.length === 0 ? "" : `<p><b>${name}:</b></p><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

/** What a character is like, then, folded, what they hide: what a fabrication or a spoiler is judged against. */
function profileHtml(character: CharacterView): string {
  const looks = [character.sex, character.appearance].filter(Boolean).join("; ");
  const hidden = [
    line("Stated alibi", character.alibi),
    line("Motive", character.motive ?? "none"),
    `<p><b>Culprit:</b> ${character.isCulprit ? "yes" : "no"}</p>`,
    list("Knows", character.knowledge),
    list("Actually did", character.actions),
    character.clues.length === 0 ? "" : `<p><b>Clues:</b></p>${clueItems(character.clues)}`,
  ];
  return `${line("Personality", character.personality)}${line("Attitude towards the investigator", character.attitude)}${line("Background", character.background)}${line("Appearance", looks || null)}${list("Tells", character.tells)}${list("Agendas", character.agendas)}
<details class="fold"><summary>Alibi, motive and what they know</summary>${hidden.join("")}</details>`;
}

/** A button that opens a panel over the page, which pushes nothing down and closes again. */
function menuHtml(id: string, label: string, body: string): string {
  return `<details class="menu" id="${id}"><summary>${label}</summary><div class="panel">${body}<p><button type="button" class="quiet close">Close</button></p></div></details>`;
}

function groundTruthHtml(view: TurnView): string {
  const truth = view.groundTruth;
  const cast = truth.cast.map((character) => `<details class="fold"><summary>${escapeHtml(character.name)}</summary>${profileHtml(character)}</details>`);
  const lines = [
    view.targetAge === null ? "" : `<p><b>Target age:</b> ${view.targetAge}</p>`,
    line("Culprit", truth.culprit),
    line("What happened", truth.whatHappened),
    line("Why", truth.whyItHappened),
    truth.timeline.length > 0 ? `<ol>${truth.timeline.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ol>` : "",
    cast.length > 0 ? `<h2>The cast</h2>${cast.join("")}` : "",
  ];
  return lines.join("") || `<p class="muted">the blueprint records none</p>`;
}

/** A judge's findings at a turn with more than this many are folded under their one line. */
const FOLD_AFTER = 2;

function findingHtml(judge: string, finding: StoredFinding): string {
  const kind = describeJudgeKind(judge, finding.judge_kind);
  const head = `<b>${finding.severity}</b>${kind ? ` &middot; ${escapeHtml(kind)}` : ""}`;
  const quote = finding.quote ? `<blockquote>${escapeHtml(finding.quote)}</blockquote>` : "";
  const why = finding.why ? `<p>${escapeHtml(finding.why)}</p>` : "";
  const refers = finding.refers_to ? `<p class="muted">refers to <code>${escapeHtml(finding.refers_to)}</code></p>` : "";
  const unworded = quote || why ? "" : `<p class="muted">the stored result keeps no reason</p>`;
  return `<li>${head}${quote}${why}${refers}${unworded}</li>`;
}

function runHtml(run: VerdictAtTurn): string {
  if (run.findings.length === 0) return `<li>run ${run.sample}: <span class="muted">nothing at this turn</span></li>`;
  return `<li>run ${run.sample}<ul class="findings">${run.findings.map((finding) => findingHtml(run.judge, finding)).join("")}</ul></li>`;
}

function tallyLine(tally: JudgeTally): string {
  const who = `${escapeHtml(tally.judge)} (${escapeHtml(tally.model)})`;
  const severities = [tally.major > 0 ? `${tally.major} major` : "", tally.minor > 0 ? `${tally.minor} minor` : ""].filter(Boolean).join(", ");
  const judged = tally.runs.length;
  return `${who}: ${tally.flagged} of ${judged} ${judged === 1 ? "run" : "runs"} flagged this turn${severities ? `: ${severities}` : ""}`;
}

function tallyHtml(tally: JudgeTally): string {
  const found = tally.runs.reduce((count, run) => count + run.findings.length, 0);
  return `<details class="judge"${found > FOLD_AFTER ? "" : " open"}><summary>${tallyLine(tally)}</summary><ul class="runs">${tally.runs.map(runHtml).join("")}</ul></details>`;
}

/** The second pass's disagreements on a turn: per judge and model, how many runs flagged it, and what each said. */
export function renderDisagreements(disagreements: readonly Disagreement[]): string {
  const blocks = disagreements.map((item) => {
    const heading = item.label === "clean" ? `a judge caught <b>${item.kind}</b>, the label says clean` : `labelled <b>${item.kind}</b>, no judge caught it`;
    return `<p>${heading}</p>${tallyByJudge(item.verdicts).map(tallyHtml).join("")}`;
  });
  return `<section><h2>Where a judge and the label disagree</h2>${blocks.join("")}</section>`;
}

const EMPTY_FAULT: FormFault = { kind: "", severity: "minor", note: "" };

function optionsHtml(values: readonly { value: string; name: string }[], chosen: string): string {
  return values.map(({ value, name }) => `<option value="${escapeHtml(value)}"${value === chosen ? " selected" : ""}>${escapeHtml(name)}</option>`).join("");
}

/** One fault's row: its kind, its severity, its note, and a way to remove it. */
function faultRowHtml(fault: FormFault, current: boolean): string {
  const kinds = optionsHtml([{ value: "", name: "kind…" }, ...KEYED_KINDS.map((kind) => ({ value: kind, name: kind.replace(/_/g, " ") }))], fault.kind);
  const severities = optionsHtml(["minor", "major"].map((severity) => ({ value: severity, name: severity })), fault.severity);
  return `<fieldset class="fault${current ? " current" : ""}"><select name="kind" aria-label="Kind">${kinds}</select><select name="severity" aria-label="Severity">${severities}</select><button type="button" class="quiet remove">Remove</button><input type="text" name="note" value="${escapeHtml(fault.note)}" autocomplete="off" aria-label="Note" placeholder="what is wrong"></fieldset>`;
}

function keysHelp(): string {
  const kinds = Object.entries(KIND_KEYS).map(([key, kind]) => `<kbd>${key}</kbd> ${kind.replace(/_/g, " ")}`);
  const severities = Object.entries(SEVERITY_KEYS).map(([key, severity]) => `<kbd>${key}</kbd> ${severity}`);
  return `<p class="keys muted"><kbd>${ADD_KEY}</kbd> adds a fault; the keys set the current one: ${kinds.join(", ")}; ${severities.join(", ")}; <kbd>${NOTE_KEY}</kbd> types its note (<kbd>Esc</kbd> leaves it); <kbd>${REMOVE_KEY}</kbd> removes it.</p>`;
}

function formHtml(page: TurnPage): string {
  const { faults } = page.form;
  const rows = faults.map((fault, index) => faultRowHtml(fault, index === faults.length - 1)).join("");
  return `<section><form id="label" method="post" action="${page.base}/turn/${page.view.sequence}">
<h2>Faults in this turn</h2><div id="faults" class="faults">${rows}</div>
<template id="fault-row">${faultRowHtml(EMPTY_FAULT, false)}</template>
${keysHelp()}
<div class="actions"><button type="submit">Save and go on <kbd>Enter</kbd></button><button type="button" id="add" class="quiet">Add a fault <kbd>${ADD_KEY}</kbd></button><button type="button" id="clean" class="quiet">Clean <kbd>${CLEAN_KEY}</kbd></button></div>
</form></section>`;
}

function navHtml(page: TurnPage): string {
  const previous = page.previous === null ? "" : `<a id="previous" href="${page.base}/turn/${page.previous}">previous <kbd>${PREVIOUS_KEY}</kbd></a>`;
  const next = page.next === null ? "" : `<a href="${page.base}/turn/${page.next}">skip to the next</a>`;
  const all = `<a href="${page.base}/done">every turn of this pass</a>`;
  return `<p>${[previous, next, all].filter(Boolean).join(" &middot; ")}</p>`;
}

/** The game, the story's target age, and where a pass stands: the start of every page of a pass. */
export function passTitle(game: string, targetAge: number | null, phaseName: string): string {
  return [escapeHtml(game), targetAge === null ? null : `age ${targetAge}`, escapeHtml(phaseName)].filter(Boolean).join(" &middot; ");
}

/** What the player did: the command, their line, and on a conversation the profile of whom they talk to. */
function playerHtml(view: TurnView): string {
  const profile = view.character === null ? "" : menuHtml("profile", `${escapeHtml(view.character.name)}: profile`, profileHtml(view.character));
  return `<section><h2>The player</h2><p class="command"><code>${escapeHtml(view.eventType)}</code></p><p>${escapeHtml(view.playerLine)}</p>${profile}</section>`;
}

/** The page of one turn: what happened, the form, and in the second pass the disagreements. */
export function renderTurnPage(page: TurnPage): string {
  const { view } = page;
  const heading = `${passTitle(page.game, view.targetAge, page.phaseName)} &middot; turn ${view.position} of ${view.total}`;
  const body = `<div class="title"><h1>${heading}</h1>${menuHtml("truth", `Ground truth <kbd>${TRUTH_KEY}</kbd>`, groundTruthHtml(view))}</div>
${page.error ? `<section><p class="error" role="alert">Not saved: ${escapeHtml(page.error)}</p></section>` : ""}
${playerHtml(view)}
<section><h2>Narration</h2><p class="narration">${escapeHtml(view.narration)}</p></section>
<section><h2>Clues this turn revealed</h2>${cluesHtml(view)}</section>
${page.disagreements.length > 0 ? renderDisagreements(page.disagreements) : ""}
${formHtml(page)}
${page.labelled ? `<p class="muted">Latest label: ${escapeHtml(page.labelled)}</p>` : ""}
${navHtml(page)}`;
  return shell(`${page.game}, turn ${view.position}`, body, page.who, KEYBOARD_GLUE);
}

export interface DonePage {
  game: string;
  phaseName: string;
  base: string;
  who: string;
  targetAge: number | null;
  /** The turns of this pass, each with whether the pass has labelled it. */
  turns: { sequence: number; done: boolean }[];
  message: string;
}

/** The page of a pass with every turn listed: shown when no turn is left, and on asking. */
export function renderDonePage(page: DonePage): string {
  const links = page.turns.map((turn, index) => `<li><a href="${page.base}/turn/${turn.sequence}">turn ${index + 1}</a>${turn.done ? "" : ` <span class="muted">(not yet)</span>`}</li>`);
  const body = `<h1>${passTitle(page.game, page.targetAge, page.phaseName)}</h1><section><p>${escapeHtml(page.message)}</p><ul>${links.join("")}</ul></section>`;
  return shell(`${page.game}, ${page.phaseName}`, body, page.who);
}

export function renderMessagePage(title: string, message: string, who: string | null = null): string {
  return shell(title, `<h1>${escapeHtml(title)}</h1><section><p>${escapeHtml(message)}</p><p><a href="/">back to the games</a></p></section>`, who);
}

/** The page that asks who is labelling; `back` is where to go once it is set. */
export function renderNamePage(current: string | null, back: string, error: string | null = null): string {
  const body = `<h1>Who is labelling?</h1>
${error ? `<section><p class="error" role="alert">${escapeHtml(error)}</p></section>` : ""}
<section><form method="post" action="/name">
<p>Every label you save records this name, and the label files are public: use a handle, such as your GitHub one, not your real name.</p>
<p><input type="text" name="name" value="${escapeHtml(current ?? "")}" autocomplete="username" autocapitalize="off" spellcheck="false" required></p>
<input type="hidden" name="back" value="${escapeHtml(back)}">
<div class="actions"><button type="submit">Use this name</button></div>
</form></section>`;
  return shell("Who is labelling?", body, current);
}

/**
 * The glue: a key press or a tap becomes an action (`keys.ts`), and the action
 * moves the form. The rows are the form's own state, so a failed save
 * re-renders them as they were typed. Opening one menu closes the other.
 */
const KEYBOARD_GLUE = `<script type="module">
import { actionForKey, applyAction } from "/keys.js";
const form = document.getElementById("label");
const list = document.getElementById("faults");
const template = document.getElementById("fault-row");
const rows = () => [...list.children];
let current = rows().length - 1;
const read = () => ({
  current,
  faults: rows().map((row) => ({ kind: row.elements.kind.value, severity: row.elements.severity.value, note: row.elements.note.value })),
});
const mark = () => rows().forEach((row, index) => row.classList.toggle("current", index === current));
const write = (draft) => {
  while (rows().length < draft.faults.length) list.append(template.content.firstElementChild.cloneNode(true));
  while (rows().length > draft.faults.length) list.lastElementChild.remove();
  draft.faults.forEach((fault, index) => {
    const fields = rows()[index].elements;
    fields.kind.value = fault.kind;
    fields.severity.value = fault.severity;
    fields.note.value = fault.note;
  });
  current = draft.current;
  mark();
};
const act = (action) => write(applyAction(read(), action));
list.addEventListener("focusin", (event) => {
  const row = event.target.closest(".fault");
  if (row) { current = rows().indexOf(row); mark(); }
});
list.addEventListener("click", (event) => {
  const remove = event.target.closest(".remove");
  if (!remove) return;
  current = rows().indexOf(remove.closest(".fault"));
  act({ type: "remove-fault" });
});
document.getElementById("add").addEventListener("click", () => act({ type: "add-fault" }));
const clean = () => { act({ type: "clean" }); form.requestSubmit(); };
document.getElementById("clean").addEventListener("click", clean);
const menus = [...document.querySelectorAll("details.menu")];
for (const menu of menus) {
  menu.addEventListener("toggle", () => { if (menu.open) for (const other of menus) if (other !== menu) other.open = false; });
  menu.querySelector(".close").addEventListener("click", () => { menu.open = false; });
}
const truth = document.getElementById("truth");
const pressed = (element) => element instanceof HTMLButtonElement || element instanceof HTMLAnchorElement || element?.tagName === "SUMMARY";
document.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const action = actionForKey(event.key, document.activeElement?.name === "note");
  if (!action) return;
  if (action.type === "save" && pressed(document.activeElement)) return;
  event.preventDefault();
  if (action.type === "focus-note") { act(action); rows()[current].elements.note.focus(); }
  else if (action.type === "leave-note") document.activeElement.blur();
  else if (action.type === "save") form.requestSubmit();
  else if (action.type === "clean") clean();
  else if (action.type === "previous") document.getElementById("previous")?.click();
  else if (action.type === "toggle-truth") truth.open = !truth.open;
  else if (action.type === "close") for (const menu of menus) menu.open = false;
  else act(action);
});
</script>`;
