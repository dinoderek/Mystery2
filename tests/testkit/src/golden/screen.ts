// What the player sees, built from a driver's outcomes the way the browser
// builds it: the lines of the transcript, grouped into pages, with the mode and
// the turns left after each step. Rendering it as text gives the golden file.

import { INVESTIGATOR_SPEAKER, SYSTEM_SPEAKER } from "../../../../web/src/lib/domain/speaker.ts";
import { buildSessionPages } from "../../../../web/src/lib/domain/session-pages.ts";
import type { NarrationEvent, NarrationPart, Speaker } from "../../../../web/src/lib/types/game.ts";
import type { GameDriver, GameMode, LineOutcome, OutcomeEvent } from "./driver.ts";

/** One step of a script: a line the player types, or stepping into the starting location. */
export type ScriptStep = string | { enter: true };

/** The opening `game-start` shows before the player does anything. */
export interface Opening {
  mysteryTitle: string;
  mode: GameMode;
  time_remaining: number;
  events: OutcomeEvent[];
}

interface StepRecord {
  label: string;
  mode: GameMode;
  time_remaining: number;
  overlay: string | null;
  clues: string[];
  result: "win" | "lose" | null;
}

const CASE_OVER_LINE =
  "This case is over. Press Tab to review your notebook, or any other key to go back to the list of mysteries.";

export class Screen {
  private readonly history: NarrationEvent[] = [];
  private readonly stepOfEvent = new Map<NarrationEvent, number>();
  private readonly steps: StepRecord[] = [];
  private readonly knownClues = new Set<string>();
  private readonly mysteryTitle: string;
  private mode: GameMode;
  private timeRemaining: number;
  private caseOver = false;

  constructor(opening: Opening) {
    this.mysteryTitle = opening.mysteryTitle;
    this.mode = opening.mode;
    this.timeRemaining = opening.time_remaining;
    this.record("(start)", null, [], null);
    for (const event of opening.events) this.append(event.event_type, event.narration_parts, event.payload);
  }

  /** Plays every step in order; the case may end on the last one only. */
  async play(driver: GameDriver, script: ScriptStep[]): Promise<void> {
    for (const step of script) {
      if (this.caseOver) {
        throw new Error(`The script goes on after the case ended: ${JSON.stringify(step)}`);
      }
      if (typeof step === "string") {
        await this.submit(driver, step);
      } else {
        this.apply("(enter)", null, await driver.enter());
      }
    }
  }

  private async submit(driver: GameDriver, line: string): Promise<void> {
    this.apply(JSON.stringify(line), line, await driver.submit(line));
  }

  private apply(label: string, input: string | null, outcome: LineOutcome): void {
    let overlay: string | null = null;
    let clues: string[] = [];
    let result: "win" | "lose" | null = null;
    // Opening the notebook leaves no trace in the transcript; everything else echoes the line.
    const echoes = input !== null && !(outcome.kind === "view" && !outcome.echo);
    const stepNumber = this.steps.length;
    if (echoes) this.append("input", [part(INVESTIGATOR_SPEAKER, input)], undefined, stepNumber);

    switch (outcome.kind) {
      case "view":
        overlay = outcome.section ? `${outcome.overlay}/${outcome.section}` : outcome.overlay;
        if (outcome.note) this.append("system_response", [part(SYSTEM_SPEAKER, outcome.note)], undefined, stepNumber);
        break;
      case "refused":
        this.append("system_response", [part(SYSTEM_SPEAKER, outcome.hint)], undefined, stepNumber);
        break;
      case "quit":
        this.mode = "ended";
        this.caseOver = true;
        this.append("system_response", [part(SYSTEM_SPEAKER, CASE_OVER_LINE)], undefined, stepNumber);
        break;
      case "turn":
        this.mode = outcome.mode;
        this.timeRemaining = outcome.time_remaining;
        clues = outcome.clues.filter((clue) => !this.knownClues.has(clue.id)).map((clue) => clue.id);
        for (const id of clues) this.knownClues.add(id);
        result = outcome.result;
        if (result) this.caseOver = true;
        for (const event of outcome.events) {
          this.append(event.event_type, event.narration_parts, event.payload, stepNumber);
        }
        break;
    }
    this.record(label, overlay, clues, result);
  }

  private record(label: string, overlay: string | null, clues: string[], result: "win" | "lose" | null): void {
    this.steps.push({ label, mode: this.mode, time_remaining: this.timeRemaining, overlay, clues, result });
  }

  private append(
    eventType: string,
    parts: NarrationPart[],
    payload?: Record<string, unknown>,
    step = 0,
  ): void {
    const event: NarrationEvent = {
      sequence: this.history.length + 1,
      event_type: eventType,
      narration_parts: parts,
      payload,
    };
    this.history.push(event);
    this.stepOfEvent.set(event, step);
  }

  /** The transcript as the golden file holds it: the steps, then the pages. */
  render(game: string, blueprint: string): string {
    const lines = [`game: ${game}`, `blueprint: ${blueprint}`, "", "steps"];
    this.steps.forEach((step, index) => {
      const notes = [
        step.overlay ? `opens=${step.overlay}` : null,
        step.clues.length > 0 ? `clues=${step.clues.join(",")}` : null,
        step.result ? `result=${step.result}` : null,
      ].filter((note): note is string => note !== null);
      lines.push(
        `  ${index}  ${step.label}  mode=${step.mode} turns=${step.time_remaining}${notes.length ? ` ${notes.join(" ")}` : ""}`,
      );
    });

    const pages = buildSessionPages(this.history, { mysteryTitle: this.mysteryTitle });
    lines.push("", "pages");
    for (const page of pages) {
      lines.push(`  page ${page.index} ${page.kind} ${JSON.stringify(page.fallbackLabel)}`);
      for (const event of page.events) {
        const step = this.stepOfEvent.get(event) ?? 0;
        for (const line of event.narration_parts) {
          lines.push(`    step ${step} | ${line.speaker.label} (${line.speaker.kind}): ${JSON.stringify(line.text)}`);
        }
      }
    }
    return `${lines.join("\n")}\n`;
  }
}

function part(speaker: Speaker, text: string): NarrationPart {
  return { text, speaker, image_id: null };
}
