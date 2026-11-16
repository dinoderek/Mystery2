/**
 * The labelling server: every stored game of a truth set, each of its passes
 * (`hub.ts`), and whoever is labelling.
 *
 * It listens on the loopback address only and calls no model. It answers only
 * to its own address and the host names it is given, such as the machine's
 * name on a tailnet when `tailscale serve` forwards to it, and saves only from
 * its own pages. Who labels is a name the visitor picks, kept in a cookie,
 * else the server's default; nothing else is kept between requests, so a pass
 * resumes at its first turn the label file has not answered.
 *
 * A save that fails is shown on the page and logged, and changes nothing in
 * memory, so what the page shows is what the file holds.
 */

import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { InputError } from "../core/errors.ts";
import { latestLabel } from "../lib/truth/truth.ts";
import { parseFilter, renderHomePage } from "./home.ts";
import { isPhase, LabelHub, PHASE_NAMES } from "./hub.ts";
import type { PhaseView } from "./hub.ts";
import { renderDonePage, renderMessagePage, renderNamePage, renderTurnPage } from "./page.ts";
import { parseForm, RejectedLabel } from "./store.ts";
import { buildTurnView, formFromLabel } from "./turns.ts";
import type { FormState } from "./turns.ts";

export interface LabelServerOptions {
  /** The truth set's folder. */
  truthRoot: string;
  /** Who labels until a visitor picks a name; without it, every visitor is asked. */
  by?: string;
  /** Host names it answers to besides its loopback address, such as `mac.tailnet.ts.net`. */
  hosts?: readonly string[];
  /** 0 takes any free port. */
  port?: number;
  now?: () => Date;
  /** Where a failure goes, besides the page. */
  log?: (text: string) => void;
}

export interface LabelServer {
  url: string;
  port: number;
  hub: LabelHub;
  close(): Promise<void>;
}

const KEYS_MODULE = path.join(path.dirname(fileURLToPath(import.meta.url)), "keys.ts");
const MAX_BODY_BYTES = 64 * 1024;
export const NAME_COOKIE = "mystery_label_by";
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,38}$/;

/** A labeller's name as labels record it; throws saying what a name may be. */
export function checkName(value: string): string {
  const name = value.trim();
  if (!NAME_PATTERN.test(name)) throw new InputError(`"${name}" is not a name to label as: use 1 to 39 letters, digits, dots, dashes or underscores, such as a GitHub handle`);
  return name;
}

/** The keyboard module as the browser loads it: the same source with its types removed. */
async function browserKeys(): Promise<string> {
  const { default: ts } = await import("typescript");
  const source = await fs.readFile(KEYS_MODULE, "utf8");
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
}

/** The request's body; one over the limit is read and dropped, so the refusal can still be answered. */
function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    request.on("end", () => (size > MAX_BODY_BYTES ? reject(new RejectedLabel("the form is too large")) : resolve(Buffer.concat(chunks).toString("utf8"))));
    request.on("error", reject);
  });
}

interface Route {
  game: string;
  phase: string;
  /** The pass's start, the list of its turns, or one turn. */
  at: "start" | "done" | number;
}

/** A path under `/g/<game>/<phase>`; null for any other. */
function routeOf(pathname: string): Route | null {
  const match = /^\/g\/([^/]+)\/([^/]+)(?:\/(?:(done)|turn\/(\d+))?)?$/.exec(pathname);
  if (!match) return null;
  let game: string;
  try {
    game = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  let at: Route["at"] = "start";
  if (match[3]) at = "done";
  else if (match[4]) at = Number(match[4]);
  return { game, phase: match[2], at };
}

/** A path on this server to go back to; anything else is the list of games. */
function localPath(value: string | null): string {
  // A browser reads a backslash as a slash, so `/\\host` would leave the server too.
  return value !== null && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "/";
}

function cookieName(request: http.IncomingMessage): string | null {
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key !== NAME_COOKIE) continue;
    try {
      return checkName(decodeURIComponent(rest.join("=")));
    } catch {
      return null;
    }
  }
  return null;
}

function send(response: http.ServerResponse, status: number, body: string, type = "text/html; charset=utf-8"): void {
  response.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  response.end(body);
}

function redirect(response: http.ServerResponse, location: string, headers: Record<string, string> = {}): void {
  response.writeHead(303, { location, "cache-control": "no-store", ...headers });
  response.end();
}

function turnPage(view: PhaseView, sequence: number, who: string, form?: FormState, error: string | null = null): string | null {
  const turns = view.turns();
  const index = turns.indexOf(sequence);
  if (index < 0) return null;
  const label = latestLabel(view.store.labels, sequence);
  return renderTurnPage({
    game: view.game.id,
    phaseName: PHASE_NAMES[view.phase],
    base: view.base,
    who,
    view: buildTurnView(view.game.trace, sequence, index + 1, turns.length),
    form: form ?? formFromLabel(label),
    labelled: label ? `${label.by}, ${label.at}, pass ${label.pass}` : null,
    error,
    previous: turns[index - 1] ?? null,
    next: turns[index + 1] ?? null,
    disagreements: view.disagreements(sequence),
  });
}

function donePage(view: PhaseView, who: string): string {
  const turns = view.turns().map((sequence) => ({ sequence, done: view.done(sequence) }));
  return renderDonePage({ game: view.game.id, phaseName: PHASE_NAMES[view.phase], base: view.base, who, turns, message: view.summary() });
}

/** Starts the server on the loopback address over the truth set at `truthRoot`. */
export async function startLabelServer(options: LabelServerOptions): Promise<LabelServer> {
  const hub = await LabelHub.load(options.truthRoot, options.now ?? (() => new Date()));
  const fallback = options.by === undefined ? null : checkName(options.by);
  const log = options.log ?? (() => undefined);
  const keys = await browserKeys();
  let origin = "";
  let hosts: string[] = [];
  const allowed = (host: string | undefined) => host !== undefined && hosts.includes(host.toLowerCase());

  const fromThisPage = (header: string | undefined): boolean => {
    if (header === undefined) return true;
    try {
      return allowed(new URL(header).host);
    } catch {
      return false;
    }
  };

  const whoIs = (request: http.IncomingMessage) => cookieName(request) ?? fallback;

  /** The pass a route names, its labels read afresh unless a save is about to; null once a refusal is sent. */
  const viewOf = async (route: Route, response: http.ServerResponse, who: string, refresh: boolean): Promise<PhaseView | null> => {
    if (!isPhase(route.phase)) {
      send(response, 404, renderMessagePage("Not here", `"${route.phase}" is not a pass: pass-1, reported or pass-2.`, who));
      return null;
    }
    const store = hub.labelsOf(route.game);
    if (refresh && store !== null) {
      try {
        await store.refresh();
      } catch (error) {
        log(`the label file of ${route.game} could not be read: ${(error as Error).stack ?? String(error)}`);
        send(response, 500, renderMessagePage("Not read", `The label file of ${route.game} could not be read: ${(error as Error).message}`, who));
        return null;
      }
    }
    try {
      return hub.phase(route.game, route.phase);
    } catch (error) {
      if (!(error instanceof InputError)) throw error;
      send(response, 404, renderMessagePage("Not here", error.message, who));
      return null;
    }
  };

  const saveTurn = async (view: PhaseView, sequence: number, who: string, request: http.IncomingMessage, response: http.ServerResponse): Promise<void> => {
    let form: FormState | undefined;
    try {
      if (!view.turns().includes(sequence)) return send(response, 404, renderMessagePage("Not here", "That turn is not in this pass.", who));
      form = parseForm(await readBody(request));
      await view.store.save(sequence, form, who, view.pass);
      return redirect(response, view.after(sequence));
    } catch (error) {
      const rejected = error instanceof RejectedLabel;
      const message = (error as Error).message;
      log(`label for turn ${sequence} of ${view.game.id} not saved: ${rejected ? message : ((error as Error).stack ?? message)}`);
      const page = turnPage(view, sequence, who, form, rejected ? message : `the file could not be written: ${message}`);
      return send(response, rejected ? 422 : 500, page ?? renderMessagePage("Not saved", message, who));
    }
  };

  const handleRoute = async (route: Route, request: http.IncomingMessage, response: http.ServerResponse, url: URL): Promise<void> => {
    if (request.method === "POST" && !fromThisPage(request.headers.origin)) {
      return send(response, 403, renderMessagePage("Refused", "A save must come from this page."));
    }
    const who = whoIs(request);
    if (who === null) return redirect(response, `/name?back=${encodeURIComponent(url.pathname)}`);
    const view = await viewOf(route, response, who, request.method === "GET");
    if (view === null) return;
    if (request.method === "POST" && typeof route.at === "number") return saveTurn(view, route.at, who, request, response);
    if (request.method !== "GET") return send(response, 404, renderMessagePage("Not here", "Nothing answers there.", who));
    if (route.at === "start") {
      const first = view.firstOpen();
      return redirect(response, first === null ? `${view.base}/done` : `${view.base}/turn/${first}`);
    }
    if (route.at === "done") return send(response, 200, donePage(view, who));
    const page = turnPage(view, route.at, who);
    return page === null ? send(response, 404, renderMessagePage("Not here", "That turn is not in this pass.", who)) : send(response, 200, page);
  };

  const saveName = async (request: http.IncomingMessage, response: http.ServerResponse): Promise<void> => {
    if (!fromThisPage(request.headers.origin)) return send(response, 403, renderMessagePage("Refused", "A name must be set from this page."));
    let params: URLSearchParams;
    try {
      params = new URLSearchParams(await readBody(request));
    } catch (error) {
      if (!(error instanceof RejectedLabel)) throw error;
      return send(response, 422, renderNamePage(whoIs(request), "/", error.message));
    }
    const back = localPath(params.get("back"));
    let name: string;
    try {
      name = checkName(params.get("name") ?? "");
    } catch (error) {
      return send(response, 422, renderNamePage(whoIs(request), back, (error as Error).message));
    }
    const cookie = `${NAME_COOKIE}=${encodeURIComponent(name)}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`;
    return redirect(response, back, { "set-cookie": cookie });
  };

  const handle = async (request: http.IncomingMessage, response: http.ServerResponse): Promise<void> => {
    // A page on another site must not read or write labels through the browser.
    if (!allowed(request.headers.host)) return send(response, 403, renderMessagePage("Refused", "This server answers only on its own address."));
    const url = new URL(request.url ?? "/", origin);
    const route = routeOf(url.pathname);
    if (route !== null) return handleRoute(route, request, response, url);
    if (request.method === "GET") {
      if (url.pathname === "/keys.js") return send(response, 200, keys, "text/javascript; charset=utf-8");
      if (url.pathname === "/") return send(response, 200, renderHomePage(await hub.summaries(), parseFilter(url.searchParams), whoIs(request)));
      if (url.pathname === "/name") return send(response, 200, renderNamePage(whoIs(request), localPath(url.searchParams.get("back"))));
    }
    if (request.method === "POST" && url.pathname === "/name") return saveName(request, response);
    return send(response, 404, renderMessagePage("Not here", "Nothing answers there.", whoIs(request)));
  };

  const server = http.createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      log(`the labelling page broke: ${(error as Error)?.stack ?? String(error)}`);
      if (!response.headersSent) send(response, 500, renderMessagePage("Broke", "The labelling page broke; the terminal has the details."));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  origin = `http://127.0.0.1:${port}`;
  const names = (options.hosts ?? []).map((name) => name.toLowerCase());
  hosts = [`127.0.0.1:${port}`, `localhost:${port}`, ...names, ...names.map((name) => `${name}:443`)];
  return {
    url: `${origin}/`,
    port,
    hub,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
