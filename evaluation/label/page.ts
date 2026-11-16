/**
 * The labelling page's HTML. Every page is rendered by the server and every
 * save is a form post, so the browser needs no script beyond the keyboard glue
 * at the bottom, which only reads and writes the form (`keys.ts` decides what a
 * key means). On a touch screen the kinds and severities are large buttons
 * and the save stays at the bottom of the screen; the keys are not shown.
 */

import { CLEAN_KEY, KEYED_KINDS, KIND_KEYS, NOTE_KEY, PREVIOUS_KEY, SEVERITY_KEYS } from "./keys.ts";
import type { Disagreement } from "./disagreements.ts";
import type { FormState, TurnView } from "./turns.ts";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

const STYLE = `
:root { color-scheme: light dark; --bg: #fbfaf7; --fg: #1d1c1a; --muted: #6b675f; --line: #d9d4c9; --card: #fff; --accent: #2f5d50; --bad: #a3261c; }
@media (prefers-color-scheme: dark) { :root { --bg: #17171a; --fg: #ecebe6; --muted: #9a978f; --line: #35343a; --card: #202024; --accent: #7fc4ad; --bad: #ff8f84; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 16px 12px 32px; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; }
main { max-width: 46rem; margin: 0 auto; }
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
.choices { display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0 12px; }
.choices label { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 6px 14px; border: 1px solid var(--line); border-radius: 999px; cursor: pointer; }
.choices label:has(input:checked) { border-color: var(--accent); background: var(--accent); color: var(--bg); }
.choices input { margin: 0; }
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
.scroll { overflow-x: auto; }
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

function cluesHtml(view: TurnView): string {
  if (view.clues.length === 0) return `<p class="muted">none</p>`;
  const items = view.clues.map((clue) => `<li>${escapeHtml(clue.id)}: ${clue.text === null ? `<span class="muted">(no such clue in the blueprint)</span>` : escapeHtml(clue.text)}</li>`);
  return `<ul>${items.join("")}</ul>`;
}

function groundTruthHtml(view: TurnView): string {
  const truth = view.groundTruth;
  const lines = [
    truth.culprit ? `<p><b>Culprit:</b> ${escapeHtml(truth.culprit)}</p>` : "",
    truth.whatHappened ? `<p><b>What happened:</b> ${escapeHtml(truth.whatHappened)}</p>` : "",
    truth.whyItHappened ? `<p><b>Why:</b> ${escapeHtml(truth.whyItHappened)}</p>` : "",
    truth.timeline.length > 0 ? `<ol>${truth.timeline.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ol>` : "",
  ];
  return lines.join("") || `<p class="muted">the blueprint records none</p>`;
}

function disagreementsHtml(disagreements: readonly Disagreement[]): string {
  const blocks = disagreements.map((item) => {
    const heading = item.label === "clean" ? `a judge caught <b>${item.kind}</b>, the label says clean` : `labelled <b>${item.kind}</b>, no judge caught it`;
    const rows = item.verdicts.map((verdict) => {
      const found = verdict.findings.map((finding) => `${finding.severity}${finding.judge_kind ? `, ${escapeHtml(finding.judge_kind)}` : ""}`);
      return `<tr><td>${escapeHtml(verdict.judge)}</td><td>${escapeHtml(verdict.model)} #${verdict.sample}</td><td>${verdict.status}</td><td>${found.length > 0 ? found.join("; ") : `<span class="muted">nothing at this turn</span>`}</td></tr>`;
    });
    return `<p>${heading}</p><div class="scroll"><table>${rows.join("")}</table></div>`;
  });
  return `<section><h2>Where a judge and the label disagree</h2>${blocks.join("")}</section>`;
}

function formHtml(page: TurnPage): string {
  const { form } = page;
  const kinds = KEYED_KINDS.map((kind) => {
    const key = Object.entries(KIND_KEYS).find(([, value]) => value === kind)?.[0];
    return `<label><input type="checkbox" name="kind" value="${kind}"${form.kinds.includes(kind) ? " checked" : ""}> <kbd>${key}</kbd> ${kind.replace(/_/g, " ")}</label>`;
  });
  const severities = (["minor", "major"] as const).map((severity) => {
    const key = Object.entries(SEVERITY_KEYS).find(([, value]) => value === severity)?.[0];
    return `<label><input type="radio" name="severity" value="${severity}"${form.severity === severity ? " checked" : ""}> <kbd>${key}</kbd> ${severity}</label>`;
  });
  return `<section><form id="label" method="post" action="${page.base}/turn/${page.view.sequence}">
<h2>Faults in this turn</h2><div class="choices">${kinds.join("")}</div>
<h2>Severity</h2><div class="choices">${severities.join("")}</div>
<h2>Note<span class="keys"> (<kbd>${NOTE_KEY}</kbd> to type, <kbd>Esc</kbd> to leave)</span></h2>
<input type="text" name="note" value="${escapeHtml(form.note)}" autocomplete="off" placeholder="what is wrong, for a fault">
<div class="actions"><button type="submit">Save and go on <kbd>Enter</kbd></button><button type="button" id="clean" class="quiet">Clean <kbd>${CLEAN_KEY}</kbd></button></div>
</form></section>`;
}

function navHtml(page: TurnPage): string {
  const previous = page.previous === null ? "" : `<a id="previous" href="${page.base}/turn/${page.previous}">previous <kbd>${PREVIOUS_KEY}</kbd></a>`;
  const next = page.next === null ? "" : `<a href="${page.base}/turn/${page.next}">skip to the next</a>`;
  const all = `<a href="${page.base}/done">every turn of this pass</a>`;
  return `<p>${[previous, next, all].filter(Boolean).join(" &middot; ")}</p>`;
}

/** The page of one turn: what happened, the form, and in the second pass the disagreements. */
export function renderTurnPage(page: TurnPage): string {
  const { view } = page;
  const heading = `${escapeHtml(page.game)} &middot; ${escapeHtml(page.phaseName)} &middot; turn ${view.position} of ${view.total} <span class="muted">(event ${view.sequence}, ${escapeHtml(view.eventType)})</span>`;
  const body = `<h1>${heading}</h1>
${page.error ? `<section><p class="error" role="alert">Not saved: ${escapeHtml(page.error)}</p></section>` : ""}
<section><h2>The player</h2><p>${escapeHtml(view.playerLine)}</p></section>
<section><h2>Narration</h2><p class="narration">${escapeHtml(view.narration)}</p></section>
<section><h2>Clues this turn revealed</h2>${cluesHtml(view)}</section>
<section><details id="truth"><summary><h2>Ground truth</h2></summary>${groundTruthHtml(view)}</details></section>
${page.disagreements.length > 0 ? disagreementsHtml(page.disagreements) : ""}
${formHtml(page)}
${page.labelled ? `<p class="muted">Latest label: ${escapeHtml(page.labelled)}</p>` : ""}
${navHtml(page)}`;
  return shell(`${page.game}, turn ${view.sequence}`, body, page.who, KEYBOARD_GLUE);
}

export interface DonePage {
  game: string;
  phaseName: string;
  base: string;
  who: string;
  /** The turns of this pass, each with whether the pass has labelled it. */
  turns: { sequence: number; done: boolean }[];
  message: string;
}

/** The page of a pass with every turn listed: shown when no turn is left, and on asking. */
export function renderDonePage(page: DonePage): string {
  const links = page.turns.map((turn) => `<li><a href="${page.base}/turn/${turn.sequence}">turn ${turn.sequence}</a>${turn.done ? "" : ` <span class="muted">(not yet)</span>`}</li>`);
  const body = `<h1>${escapeHtml(page.game)} &middot; ${escapeHtml(page.phaseName)}</h1><section><p>${escapeHtml(page.message)}</p><ul>${links.join("")}</ul></section>`;
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
 * The glue: a key press becomes an action (`keys.ts`), and the action moves
 * the form. Ticking and the severity are the form's own state, so a failed
 * save re-renders them as they were typed. On a wide screen the ground truth
 * starts open.
 */
const KEYBOARD_GLUE = `<script type="module">
import { actionForKey, applyAction } from "/keys.js";
if (matchMedia("(min-width: 48rem)").matches) document.getElementById("truth").open = true;
const form = document.getElementById("label");
const note = form.elements.note;
const read = () => ({
  kinds: [...form.querySelectorAll("input[name=kind]:checked")].map((box) => box.value),
  severity: form.querySelector("input[name=severity]:checked").value,
});
const write = (selection) => {
  for (const box of form.querySelectorAll("input[name=kind]")) box.checked = selection.kinds.includes(box.value);
  form.querySelector("input[name=severity][value=" + selection.severity + "]").checked = true;
};
const clean = () => { write(applyAction(read(), { type: "clean" })); note.value = ""; form.requestSubmit(); };
document.getElementById("clean").addEventListener("click", clean);
document.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const action = actionForKey(event.key, document.activeElement === note);
  if (!action) return;
  if (action.type === "save" && (document.activeElement instanceof HTMLButtonElement || document.activeElement instanceof HTMLAnchorElement)) return;
  event.preventDefault();
  if (action.type === "focus-note") note.focus();
  else if (action.type === "leave-note") note.blur();
  else if (action.type === "save") form.requestSubmit();
  else if (action.type === "clean") clean();
  else if (action.type === "previous") document.getElementById("previous")?.click();
  else write(applyAction(read(), action));
});
</script>`;
