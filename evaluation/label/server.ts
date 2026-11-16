/**
 * The labelling server: one stored game, one pass, one person.
 *
 * It listens on the loopback address only and calls no model. Each request
 * renders from the truth set it loaded at start; a save appends a label to the
 * game's label file and is checked by the truth schema before the next turn is
 * served. A save that fails is shown on the page and logged, and changes
 * nothing in memory, so what the page shows is what the file holds.
 *
 * The first pass shows no judge finding: it reads the stored results only for
 * `reported`, to pick its turns, and keeps no verdict, so no response can carry
 * one. The second reads them, and lists only the turns where a judge and the
 * label disagree (`disagreements.ts`).
 */

import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { InputError } from "../core/errors.ts";
import { GAME_KINDS } from "../lib/truth/kinds.ts";
import type { GameKind } from "../lib/truth/kinds.ts";
import { GAME_LABELS, loadTruthSet } from "../lib/truth/loader.ts";
import type { TruthGame } from "../lib/truth/loader.ts";
import { LabelFileSchema, parseTruthFile } from "../lib/truth/schemas.ts";
import type { Fault, Label, StoredVerdict } from "../lib/truth/schemas.ts";
import { latestLabel } from "../lib/truth/truth.ts";
import { disagreementsAt, judgesGame, judgesGameOrVariant, reportedTurns } from "./disagreements.ts";
import { renderDonePage, renderMessagePage, renderTurnPage } from "./page.ts";
import { buildTurnView, formFromLabel, playedTurns } from "./turns.ts";
import type { FormState } from "./turns.ts";

export interface LabelServerOptions {
  /** The truth set's folder. */
  truthRoot: string;
  /** The stored game's id. */
  game: string;
  pass: 1 | 2;
  /** Pass 1 only: just the turns a failing verdict's finding points at (`reportedTurns`). */
  reported?: boolean;
  /** Who gives the labels, as each label records it. */
  by: string;
  /** 0 takes any free port. */
  port?: number;
  now?: () => Date;
  /** Where a failure goes, besides the page. */
  log?: (text: string) => void;
}

export interface LabelServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

/** A save the form cannot make: shown to the person, who can fix it. */
class RejectedLabel extends Error {}

const KEYS_MODULE = path.join(path.dirname(fileURLToPath(import.meta.url)), "keys.ts");
const MAX_BODY_BYTES = 64 * 1024;

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

function parseForm(body: string): FormState {
  const params = new URLSearchParams(body);
  const kinds = params.getAll("kind");
  const unknown = kinds.find((kind) => !(GAME_KINDS as readonly string[]).includes(kind));
  if (unknown !== undefined) throw new RejectedLabel(`"${unknown}" is not a kind of fault`);
  const severity = params.get("severity") ?? "minor";
  if (severity !== "minor" && severity !== "major") throw new RejectedLabel(`"${severity}" is not a severity`);
  return { kinds: [...new Set(kinds)], severity, note: (params.get("note") ?? "").trim() };
}

function faultsOf(form: FormState): Fault[] {
  if (form.kinds.length === 0) {
    if (form.note !== "") throw new RejectedLabel("a note belongs to a fault: tick a kind, or clear the note to save the turn as clean");
    return [];
  }
  if (form.note === "") throw new RejectedLabel("a fault needs a note saying what is wrong");
  return form.kinds.map((kind) => ({ kind: kind as GameKind, severity: form.severity, note: form.note }));
}

/** An id of a stored game's turn in a path such as `/turn/7`; null for any other path. */
function turnOf(pathname: string): number | null {
  const match = /^\/turn\/(\d+)$/.exec(pathname);
  return match ? Number(match[1]) : null;
}

type SessionOptions = Required<Pick<LabelServerOptions, "pass" | "by" | "now">> & {
  /** The turns pass 1 is limited to; null for every turn. */
  only: ReadonlySet<number> | null;
};

class Session {
  readonly labels: Label[];
  private saving: Promise<unknown> = Promise.resolve();

  private readonly game: TruthGame;
  private readonly labelsFile: string;
  private readonly verdicts: readonly StoredVerdict[];
  private readonly options: SessionOptions;

  constructor(game: TruthGame, labelsFile: string, verdicts: readonly StoredVerdict[], options: SessionOptions) {
    this.game = game;
    this.labelsFile = labelsFile;
    this.verdicts = verdicts;
    this.options = options;
    this.labels = [...game.labels];
  }

  get pass(): 1 | 2 {
    return this.options.pass;
  }

  /** The turns of this pass, in order: every turn (or those reported), or in the second pass those with a disagreement. */
  turns(): number[] {
    const sequences = playedTurns(this.game.trace).map((event) => event.sequence);
    const only = this.options.only;
    if (this.pass === 1) return only === null ? sequences : sequences.filter((sequence) => only.has(sequence));
    return sequences.filter((sequence) => disagreementsAt(this.game.id, this.labels, this.verdicts, sequence).length > 0);
  }

  /** Whether this pass has looked at a turn: it has a label at all (pass one), or one given in pass two. */
  private done(sequence: number): boolean {
    const label = latestLabel(this.labels, sequence);
    return label !== null && (this.pass === 1 || label.pass === 2);
  }

  firstOpen(): number | null {
    return this.turns().find((sequence) => !this.done(sequence)) ?? null;
  }

  summary(): string {
    const turns = this.turns();
    if (turns.length === 0) {
      return this.pass === 1 ? "No turn to label: no finding of a failing verdict points at a turn of this game." : "No turn needs a second look: no judge and label disagree.";
    }
    return `${turns.filter((sequence) => this.done(sequence)).length} of ${turns.length} turns done in pass ${this.pass}.`;
  }

  donePage(): string {
    const turns = this.turns().map((sequence) => ({ sequence, done: this.done(sequence) }));
    return renderDonePage({ game: this.game.id, pass: this.pass, turns, message: this.summary() });
  }

  /** The page of a turn, or null when this pass does not show it. */
  turnPage(sequence: number, form?: FormState, error: string | null = null): string | null {
    const turns = this.turns();
    const index = turns.indexOf(sequence);
    if (index < 0) return null;
    const label = latestLabel(this.labels, sequence);
    return renderTurnPage({
      game: this.game.id,
      pass: this.pass,
      view: buildTurnView(this.game.trace, sequence, index + 1, turns.length),
      form: form ?? formFromLabel(label),
      labelled: label ? `${label.by}, ${label.at}, pass ${label.pass}` : null,
      error,
      previous: turns[index - 1] ?? null,
      next: turns[index + 1] ?? null,
      disagreements: this.pass === 2 ? disagreementsAt(this.game.id, this.labels, this.verdicts, sequence) : [],
    });
  }

  /** The turn to go to after `sequence`: the next one in this pass, else the end. */
  after(sequence: number): string {
    const next = this.turns().find((candidate) => candidate > sequence);
    return next === undefined ? "/done" : `/turn/${next}`;
  }

  /** A time later than every label of the turn, so two labels never share one. */
  private stamp(sequence: number): string {
    let at = this.options.now().getTime();
    for (const label of this.labels) {
      if (label.sequence === sequence && Date.parse(label.at) >= at) at = Date.parse(label.at) + 1;
    }
    return new Date(at).toISOString();
  }

  /** Appends the turn's label: checks the whole file with the schema, writes it whole, reads it back, then keeps it. */
  save(sequence: number, form: FormState): Promise<void> {
    const run = this.saving.then(() => this.write(sequence, form));
    this.saving = run.catch(() => undefined);
    return run;
  }

  /** Writes beside the file and renames over it, so a failed save leaves the file as it was and no stray file in the set. */
  private async replaceFile(content: string): Promise<void> {
    const temporary = `${this.labelsFile}.saving`;
    await fs.mkdir(path.dirname(this.labelsFile), { recursive: true });
    try {
      await fs.writeFile(temporary, content, "utf8");
      await fs.rename(temporary, this.labelsFile);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
  }

  /** Takes the labels the file holds now, so a label added to it since is kept, never overwritten. */
  private async readFile(): Promise<void> {
    let text: string;
    try {
      text = await fs.readFile(this.labelsFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    this.labels.splice(0, this.labels.length, ...parseTruthFile(LabelFileSchema, JSON.parse(text), this.labelsFile).labels);
  }

  private async write(sequence: number, form: FormState): Promise<void> {
    await this.readFile();
    const label: Label = { sequence, faults: faultsOf(form), by: this.options.by, at: this.stamp(sequence), pass: this.pass };
    const next = { labels: [...this.labels, label] };
    const checked = LabelFileSchema.safeParse(next);
    if (!checked.success) {
      throw new RejectedLabel(checked.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
    }
    await this.replaceFile(`${JSON.stringify(next, null, 2)}\n`);
    await this.readFile();
  }
}

async function loadSession(options: LabelServerOptions): Promise<Session> {
  const set = await loadTruthSet(options.truthRoot);
  const game = set.games.find((candidate) => candidate.id === options.game);
  if (!game) {
    const known = set.games.map((candidate) => candidate.id).join(", ") || "none";
    throw new InputError(`no stored game "${options.game}" in ${options.truthRoot} (it holds: ${known})`);
  }
  if (options.reported && options.pass !== 1) throw new InputError("--reported limits pass 1; pass 2 already shows only the turns where a judge and a label disagree");
  const stored = set.results.flatMap((results) => results.verdicts);
  let only: Set<number> | null = null;
  if (options.reported) {
    if (!judgesGameOrVariant(stored, game.id)) {
      throw new InputError(
        `--reported needs stored judge results, and none in ${path.join(options.truthRoot, "results")} judge game "${game.id}" or its variants; run the judges on it first, or label every turn`,
      );
    }
    only = reportedTurns(stored, set.turnVariants, game.id);
  }
  // The first pass keeps no verdict, so it cannot show one.
  const verdicts = options.pass === 2 ? stored : [];
  if (options.pass === 2 && !judgesGame(verdicts, game.id)) {
    throw new InputError(
      `pass 2 needs stored judge results, and none in ${path.join(options.truthRoot, "results")} judge game "${game.id}"; run the judges on it first, or label in pass 1`,
    );
  }
  const labelsFile = game.labelsFile ?? path.join(options.truthRoot, "games", game.id, GAME_LABELS);
  return new Session(game, labelsFile, verdicts, {
    pass: options.pass,
    by: options.by,
    now: options.now ?? (() => new Date()),
    only,
  });
}

function send(response: http.ServerResponse, status: number, body: string, type = "text/html; charset=utf-8"): void {
  response.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  response.end(body);
}

function redirect(response: http.ServerResponse, location: string): void {
  response.writeHead(303, { location, "cache-control": "no-store" });
  response.end();
}

/** Starts the server on the loopback address; throws `InputError` when the game or the results are not there. */
export async function startLabelServer(options: LabelServerOptions): Promise<LabelServer> {
  const session = await loadSession(options);
  const log = options.log ?? (() => undefined);
  const keys = await browserKeys();
  let origin = "";
  let hosts: string[] = [];
  const allowed = (host: string | undefined) => host !== undefined && hosts.includes(host);

  const fromThisPage = (header: string | undefined): boolean => {
    if (header === undefined) return true;
    try {
      return allowed(new URL(header).host);
    } catch {
      return false;
    }
  };

  const handle = async (request: http.IncomingMessage, response: http.ServerResponse): Promise<void> => {
    // A page on another site must not read or write labels through the browser.
    if (!allowed(request.headers.host)) return send(response, 403, renderMessagePage("Refused", "This server answers only on its own address."));
    const url = new URL(request.url ?? "/", origin);
    const sequence = turnOf(url.pathname);
    if (request.method === "GET") {
      if (url.pathname === "/keys.js") return send(response, 200, keys, "text/javascript; charset=utf-8");
      if (url.pathname === "/done") return send(response, 200, session.donePage());
      if (url.pathname === "/") {
        const first = session.firstOpen();
        return redirect(response, first === null ? "/done" : `/turn/${first}`);
      }
      const page = sequence === null ? null : session.turnPage(sequence);
      if (page !== null) return send(response, 200, page);
      return send(response, 404, renderMessagePage("Not here", "That turn is not in this pass."));
    }
    if (request.method === "POST" && sequence !== null) {
      if (!fromThisPage(request.headers.origin)) {
        return send(response, 403, renderMessagePage("Refused", "A save must come from this page."));
      }
      return saveTurn(sequence, request, response);
    }
    return send(response, 404, renderMessagePage("Not here", "Nothing answers there."));
  };

  const saveTurn = async (sequence: number, request: http.IncomingMessage, response: http.ServerResponse): Promise<void> => {
    let form: FormState | undefined;
    try {
      if (session.turnPage(sequence) === null) return send(response, 404, renderMessagePage("Not here", "That turn is not in this pass."));
      form = parseForm(await readBody(request));
      await session.save(sequence, form);
      return redirect(response, session.after(sequence));
    } catch (error) {
      const rejected = error instanceof RejectedLabel;
      const message = (error as Error).message;
      log(`label for turn ${sequence} not saved: ${rejected ? message : ((error as Error).stack ?? message)}`);
      const page = session.turnPage(sequence, form, rejected ? message : `the file could not be written: ${message}`);
      return send(response, rejected ? 422 : 500, page ?? renderMessagePage("Not saved", message));
    }
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
  hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  return {
    url: `${origin}/`,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
