import { expect, type Page } from '@playwright/test';
import type { GameTurnResponse, Speaker, TurnState } from '@my2/shared';
import {
  NARRATOR_SPEAKER,
  createGameEnterResponse,
  createTurnPlayedResponse,
  createRevealedClue,
} from '../../tests/testkit/src/fixtures';

/**
 * A started case opens on the premise and waits for the player before stepping
 * into the first location, so a spec that wants to issue commands has to get
 * past that prompt first.
 *
 * The arrival narration defaults to the line most specs already assert on, so
 * the text they look for is on the page they land on.
 */
export async function confirmOpening(
  page: Page,
  narration = 'You enter the kitchen.',
) {
  await page.route('**/api/game-enter*', async (route) => {
    await route.fulfill({
      json: createGameEnterResponse({
        narration_parts: [
          { text: narration, speaker: NARRATOR_SPEAKER, image_id: null },
        ],
      }),
    });
  });

  await expect(page.getByTestId('begin-investigation-prompt')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('begin-investigation-prompt')).toBeHidden();
  await expect(page.locator('input[type="text"]')).toBeVisible();
}

/** What the page sent to `game-turn`. */
export interface TurnRequest {
  game_id: string;
  input: string;
}

/** A failed request: the status and the body the server would send. */
export interface TurnFailure {
  status: number;
  body: unknown;
}

/**
 * Answers every `game-turn` request the page sends, and returns the requests
 * as they arrive. The page sends the line as typed and the engine decides what
 * it means, so a stub decides the same way: by the line.
 */
export async function stubTurns(
  page: Page,
  answer: (request: TurnRequest, count: number) => GameTurnResponse | TurnFailure | Promise<GameTurnResponse | TurnFailure>,
): Promise<TurnRequest[]> {
  const requests: TurnRequest[] = [];
  await page.route('**/api/game-turn*', async (route) => {
    const request = route.request().postDataJSON() as TurnRequest;
    requests.push(request);
    const result = await answer(request, requests.length);
    if ('status' in result) {
      await route.fulfill({
        status: result.status,
        contentType: 'application/json',
        body: JSON.stringify(result.body),
      });
      return;
    }
    await route.fulfill({ json: result });
  });
  return requests;
}

interface PlayedOptions {
  speaker?: Speaker;
  image?: string;
  /** Further parts of the same event, after the first. */
  more?: Array<{ text: string; speaker: Speaker }>;
  payload?: Record<string, unknown>;
  /** What changed in the game; the rest stays as `createTurnPlayedResponse` has it. */
  state?: Partial<TurnState>;
  clues?: ReturnType<typeof createRevealedClue>[];
  result?: 'win' | 'lose' | null;
  /** Events the turn saved after the first: the accusation a spent last turn forces. */
  after?: Array<{ event_type: string; text: string }>;
}

/** The answer to a line that played: the event the engine saved, and where the game stands. */
export function playedTurn(eventType: string, text: string, options: PlayedOptions = {}): GameTurnResponse {
  const base = createTurnPlayedResponse();
  const speaker = options.speaker ?? NARRATOR_SPEAKER;
  const first = {
    sequence: 3,
    event_type: eventType,
    payload: options.payload,
    narration_parts: [
      { text, speaker, ...(options.image ? { image_id: options.image } : {}) },
      ...(options.more ?? []),
    ],
  };
  const forced = (options.after ?? []).map((event, index) => ({
    sequence: 4 + index,
    event_type: event.event_type,
    narration_parts: [{ text: event.text, speaker: NARRATOR_SPEAKER }],
  }));
  return createTurnPlayedResponse({
    events: [first, ...forced],
    state: { ...base.state, ...options.state },
    revealed_clues: options.clues ?? [],
    result: options.result ?? null,
  });
}
