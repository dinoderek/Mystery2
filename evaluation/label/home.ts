/**
 * The list of games the labelling page opens on: a search over the stored
 * games, by name, stage and date, and each game's passes. It shows nothing a
 * judge said until the game's first pass is complete.
 */

import { PHASE_NAMES, phasePath } from "./hub.ts";
import type { GameSummary, Stage } from "./hub.ts";
import { escapeHtml, shell } from "./page.ts";

export const STAGE_NAMES: Record<Stage, string> = {
  "not-started": "not started",
  "pass-1": "pass 1 in progress",
  "no-results": "pass 1 done, no judge results for pass 2",
  "pass-2": "pass 2 to answer",
  done: "done",
};

const STAGE_FILTERS = ["all", "todo", "not-started", "pass-1", "no-results", "pass-2", "done"] as const;
type StageFilter = (typeof STAGE_FILTERS)[number];

const SORTS = {
  "played-desc": "played, newest first",
  "played-asc": "played, oldest first",
  "labelled-desc": "last labelled, newest first",
  "labelled-asc": "last labelled, oldest first",
  name: "name",
} as const;
type Sort = keyof typeof SORTS;

export interface GameFilter {
  /** Words that must all appear in the game's name, title, persona or labellers. */
  q: string;
  stage: StageFilter;
  /** Which date `from` and `to` bound. */
  date: "played" | "labelled";
  /** `YYYY-MM-DD`, inclusive; empty for no bound. */
  from: string;
  to: string;
  sort: Sort;
}

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function day(value: string | null): string {
  return value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

/** The filter a query string asks for; anything it does not understand is left at its default. */
export function parseFilter(params: URLSearchParams): GameFilter {
  return {
    q: (params.get("q") ?? "").trim(),
    stage: pick(params.get("stage"), STAGE_FILTERS, "all"),
    date: pick(params.get("date"), ["played", "labelled"] as const, "played"),
    from: day(params.get("from")),
    to: day(params.get("to")),
    sort: pick(params.get("sort"), Object.keys(SORTS) as Sort[], "played-desc"),
  };
}

const dateOf = (game: GameSummary, which: "played" | "labelled"): string | null => (which === "played" ? game.played : (game.last?.at ?? null));

function matches(game: GameSummary, filter: GameFilter): boolean {
  if (filter.stage === "todo" ? game.stage === "done" : filter.stage !== "all" && game.stage !== filter.stage) return false;
  const haystack = [game.id, game.title ?? "", game.persona ?? "", ...game.by].join(" ").toLowerCase();
  if (!filter.q.toLowerCase().split(/\s+/).every((word) => haystack.includes(word))) return false;
  if (filter.from === "" && filter.to === "") return true;
  const date = dateOf(game, filter.date)?.slice(0, 10);
  if (date === undefined) return false;
  return (filter.from === "" || date >= filter.from) && (filter.to === "" || date <= filter.to);
}

/** The games the filter keeps, in its order; a game without the date it sorts by goes last. */
export function filterGames(games: readonly GameSummary[], filter: GameFilter): GameSummary[] {
  const kept = games.filter((game) => matches(game, filter));
  if (filter.sort === "name") return kept.sort((a, b) => a.id.localeCompare(b.id));
  const which = filter.sort.startsWith("played") ? "played" : "labelled";
  const sign = filter.sort.endsWith("desc") ? -1 : 1;
  return kept.sort((a, b) => {
    const left = dateOf(a, which);
    const right = dateOf(b, which);
    if (left === right) return a.id.localeCompare(b.id);
    if (left === null) return 1;
    if (right === null) return -1;
    return sign * left.localeCompare(right);
  });
}

function options<T extends string>(values: Record<T, string>, chosen: T): string {
  return (Object.entries(values) as [T, string][])
    .map(([value, name]) => `<option value="${value}"${value === chosen ? " selected" : ""}>${escapeHtml(name)}</option>`)
    .join("");
}

/** Whether the filter narrows or orders beyond the plain search, so its other fields start open. */
function refined(filter: GameFilter): boolean {
  return filter.stage !== "all" || filter.date !== "played" || filter.from !== "" || filter.to !== "" || filter.sort !== "played-desc";
}

function filterHtml(filter: GameFilter): string {
  const stages = { all: "any stage", todo: "not done", ...STAGE_NAMES } as Record<StageFilter, string>;
  return `<section><form method="get" action="/" class="filter">
<label>Search <input type="search" name="q" value="${escapeHtml(filter.q)}" placeholder="game, blueprint, persona or labeller"></label>
<details${refined(filter) ? " open" : ""}><summary>Stage, dates and order</summary><div class="more">
<label>Stage <select name="stage">${options(stages, filter.stage)}</select></label>
<label>Dates <select name="date">${options({ played: "played", labelled: "last labelled" }, filter.date)}</select></label>
<label>From <input type="date" name="from" value="${filter.from}"></label>
<label>To <input type="date" name="to" value="${filter.to}"></label>
<label>Sort <select name="sort">${options(SORTS, filter.sort)}</select></label>
</div></details>
<p><button type="submit">Search</button> <a href="/">clear</a></p>
</form></section>`;
}

function progressOf(game: GameSummary): string {
  const stage = game.stage === "pass-2" ? `pass 2: ${game.open} to answer` : STAGE_NAMES[game.stage];
  return `${stage} &middot; ${game.labelled} of ${game.turns} turns labelled`;
}

function gameHtml(game: GameSummary): string {
  const meta = [
    game.title ? escapeHtml(game.title) : null,
    game.targetAge === null ? null : `age ${game.targetAge}`,
    game.persona ? `persona ${escapeHtml(game.persona)}` : null,
    game.played ? `played ${escapeHtml(game.played.slice(0, 10))}` : null,
    game.last ? `last labelled ${escapeHtml(game.last.at.slice(0, 10))} by ${escapeHtml(game.last.by)}` : "never labelled",
  ].filter(Boolean);
  const links = game.phases.map((phase) => `<a class="button" href="${phasePath(game.id, phase)}/">${PHASE_NAMES[phase]}</a>`);
  return `<section class="game"><h2 class="name">${escapeHtml(game.id)}</h2>
<p class="muted">${meta.join(" &middot; ")}</p>
<p>${progressOf(game)}</p>
<p class="links">${links.join(" ")}</p></section>`;
}

/** The page of games: the search, then each game the search keeps. */
export function renderHomePage(games: readonly GameSummary[], filter: GameFilter, who: string | null): string {
  const kept = filterGames(games, filter);
  const list = kept.length > 0 ? kept.map(gameHtml).join("\n") : `<section><p class="muted">No stored game matches.</p></section>`;
  const body = `<h1>Label the truth set</h1>
${filterHtml(filter)}
<p class="muted">${kept.length} of ${games.length} games</p>
${list}`;
  return shell("Label the truth set", body, who);
}
