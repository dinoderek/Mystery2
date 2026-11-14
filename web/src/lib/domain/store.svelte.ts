import {
  BlueprintsListResponseSchema,
  ErrorResponseSchema,
  GameEnterResponseSchema,
  GameGetResponseSchema,
  GameStartResponseSchema,
  GameTurnResponseSchema,
  SessionCatalogResponseSchema,
  type GameEnterResponse,
  type GameTurnResponse,
  type TurnPlayedResponse,
  type TurnViewResponse,
} from '@my2/shared';
import { callApi, callApiGet } from '../api/client';
import type {
  Blueprint,
  DiscoveredClue,
  GameState,
  NarrationPart,
  SessionCatalog,
  Speaker,
} from '../types/game';
import { readAnswer, readContract, type ContractSchema } from './contract';
import { EMPTY_CATALOG, toGameState, toSessionCatalog } from './game-state';
import { INVESTIGATOR_SPEAKER, SYSTEM_SPEAKER } from './speaker';
import { callWithRetry, type AttemptFailure } from './store.retry';
import { buildSessionPages, type SessionPage } from './session-pages';
import { DEFAULT_NOTEBOOK_SECTION, type NotebookSection } from './notebook';
import { freshClues, linesOfTurn } from './turn-answer';

export type SessionViewerMode = 'interactive' | 'read_only_completed';

const HELP_NOTE = 'Help menu opened.';
const QUIT_NOTE =
  'This case is over. Press Tab to review your notebook, or any other key to go back to the list of mysteries.';
const UNREADABLE_NOTE =
  'Your last move may have been saved. Go back to the list of mysteries and reopen the case to see where it stands.';

/** A failed lookup, with the recovery hint the server gives for the failures a player can act on. */
function describeLookupFailure(message: string, body: unknown): string {
  const parsed = ErrorResponseSchema.safeParse(body);
  const recovery = parsed.success ? parsed.data.details?.recovery : undefined;
  return typeof recovery === 'string' ? `${message}. ${recovery}` : message;
}

export class GameSessionStore {
  game_id = $state<string | null>(null);
  blueprint_id = $state<string | null>(null);
  status = $state<'idle' | 'loading' | 'active' | 'error'>('idle');
  state = $state<GameState | null>(null);
  error = $state<string | null>(null);
  blueprints = $state<Blueprint[]>([]);
  showHelp = $state(false);
  showNotebook = $state(false);
  notebookSection = $state<NotebookSection>(DEFAULT_NOTEBOOK_SECTION);
  isRetrying = $state(false);
  retryCount = $state(0);
  lastFailedInput = $state<string | null>(null);
  accusationOutcome = $state<'win' | 'lose' | null>(null);
  awaitingReturnToList = $state(false);
  sessionCatalog = $state<SessionCatalog>(EMPTY_CATALOG);
  sessionCatalogStatus = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  sessionCatalogError = $state<string | null>(null);
  /** Which catalog request may write the result. Not reactive — nothing renders it. */
  private sessionCatalogRequestId = 0;
  viewerMode = $state<SessionViewerMode>('interactive');
  // Clues discovered on the most recent turn — drives the discovery celebration.
  recentlyDiscovered = $state<DiscoveredClue[]>([]);
  /**
   * Which page the player is reading. `null` means "follow the newest page", so
   * a fresh turn stays on screen without anyone having to advance the index.
   */
  activePageIndex = $state<number | null>(null);

  dismissRecentlyDiscovered() {
    this.recentlyDiscovered = [];
  }

  /**
   * `section` of null reopens wherever the player last was, so the notebook
   * behaves like a bookmark. Entry points that mean a specific section — the
   * `locations` / `characters` commands, the clue toast — pass one explicitly.
   *
   * Both overlays sit at z-50 with no stacking coordination, so closing help is
   * what keeps the notebook reliably on top.
   */
  openNotebook(section: NotebookSection | null = null) {
    if (section) {
      this.notebookSection = section;
    }
    this.showHelp = false;
    this.showNotebook = true;
  }

  closeNotebook() {
    this.showNotebook = false;
  }

  toggleNotebook(section: NotebookSection | null = null) {
    if (this.showNotebook) {
      this.closeNotebook();
      return;
    }
    this.openNotebook(section);
  }

  get pages(): SessionPage[] {
    if (!this.state) {
      return [];
    }
    const blueprint = this.blueprints.find((candidate) => candidate.id === this.blueprint_id);
    return buildSessionPages(this.state.history, { mysteryTitle: blueprint?.title });
  }

  get pageCount(): number {
    return this.pages.length;
  }

  get activePage(): SessionPage | null {
    const pages = this.pages;
    if (pages.length === 0) {
      return null;
    }
    const index = this.activePageIndex ?? pages.length - 1;
    return pages[Math.min(Math.max(index, 0), pages.length - 1)] ?? null;
  }

  get isOnLivePage(): boolean {
    return this.activePageIndex === null || this.activePageIndex >= this.pages.length - 1;
  }

  /**
   * True while the opening page is the only page: the player has read the
   * premise but has not yet stepped into the starting location. Derived from
   * history rather than a flag, so a session abandoned at the prompt resumes
   * back into it.
   */
  get awaitingOpeningConfirmation(): boolean {
    const pages = this.pages;
    return (
      this.viewerMode === 'interactive' &&
      pages.length === 1 &&
      pages[0].kind === 'opening'
    );
  }

  goToPage(index: number) {
    const pages = this.pages;
    if (pages.length === 0) {
      return;
    }
    const clamped = Math.min(Math.max(index, 0), pages.length - 1);
    this.activePageIndex = clamped === pages.length - 1 ? null : clamped;
  }

  goToLivePage() {
    this.activePageIndex = null;
  }

  prevPage() {
    const current = this.activePageIndex ?? this.pages.length - 1;
    this.goToPage(current - 1);
  }

  nextPage() {
    const current = this.activePageIndex ?? this.pages.length - 1;
    this.goToPage(current + 1);
  }

  async loadBlueprints() {
    this.status = 'loading';
    // The failure a request replaces must not outlive it. `error` is rendered
    // beside the blueprint list, so leaving a stale one set showed a message
    // about a request that had already been superseded.
    this.error = null;
    const answer = readAnswer(await callApi('blueprints-list'), BlueprintsListResponseSchema, 'blueprints-list');
    if (!answer.ok) {
      this.error = answer.message;
      this.status = 'error';
      return;
    }

    this.blueprints = answer.value.blueprints;
    this.status = 'idle';
  }

  /**
   * Loads the in-progress/completed catalog.
   *
   * `force` means "I need current data" — a route mount, or a return from a
   * session — so it must issue its own request even while one is in flight.
   * Dropping it left whatever the older request answered on screen with
   * nothing to retry it: a failure there was permanent. The request id is what
   * makes reissuing safe; only the newest request may write the result, so a
   * slow loser cannot land on top of the answer that replaced it.
   */
  async loadSessionCatalog(force = false) {
    if (!force && (this.sessionCatalogStatus === 'loading' || this.sessionCatalogStatus === 'ready')) {
      return;
    }

    const requestId = ++this.sessionCatalogRequestId;
    this.sessionCatalogStatus = 'loading';
    this.sessionCatalogError = null;

    const response = await callApi('game-sessions-list');
    if (requestId !== this.sessionCatalogRequestId) {
      return;
    }

    const answer = readAnswer(response, SessionCatalogResponseSchema, 'game-sessions-list');
    if (!answer.ok) {
      this.sessionCatalog = EMPTY_CATALOG;
      this.sessionCatalogError = answer.message;
      this.sessionCatalogStatus = 'error';
      return;
    }

    this.sessionCatalog = toSessionCatalog(answer.value);
    this.sessionCatalogStatus = 'ready';
  }

  async startGame(blueprintId: string) {
    this.status = 'loading';
    this.error = null;
    const answer = readAnswer(
      await callApi('game-start', { blueprint_id: blueprintId }),
      GameStartResponseSchema,
      'game-start',
    );
    if (!answer.ok) {
      this.error = answer.message;
      this.status = 'error';
      return;
    }

    const { game_id, state, narration_events } = answer.value;
    this.game_id = game_id;
    this.blueprint_id = blueprintId;
    this.state = toGameState(state, narration_events);
    this.lastFailedInput = null;
    this.accusationOutcome = null;
    this.awaitingReturnToList = false;
    this.viewerMode = 'interactive';
    this.showHelp = false;
    this.showNotebook = false;
    this.notebookSection = DEFAULT_NOTEBOOK_SECTION;
    this.status = 'active';
  }

  async resumeSession(gameId: string) {
    this.status = 'loading';
    this.error = null;

    const response = await callApiGet('game-get', { game_id: gameId });
    const answer = readAnswer(response, GameGetResponseSchema, 'game-get');
    if (!answer.ok) {
      this.error = response.error ? describeLookupFailure(answer.message, response.data) : answer.message;
      this.status = 'idle';
      return;
    }

    const { blueprint_id, state, narration_events } = answer.value;
    this.game_id = gameId;
    this.blueprint_id = blueprint_id;
    this.state = toGameState(state, narration_events);
    this.lastFailedInput = null;
    this.isRetrying = false;
    this.retryCount = 0;
    this.showHelp = false;
    this.showNotebook = false;
    this.notebookSection = DEFAULT_NOTEBOOK_SECTION;

    if (this.state.mode === 'ended') {
      this.viewerMode = 'read_only_completed';
      this.awaitingReturnToList = true;
      const allRows = [...this.sessionCatalog.in_progress, ...this.sessionCatalog.completed];
      const row = allRows.find((entry) => entry.game_id === gameId);
      this.accusationOutcome = row?.outcome ?? null;
    } else {
      this.viewerMode = 'interactive';
      this.awaitingReturnToList = false;
      this.accusationOutcome = null;
    }

    this.status = 'active';
  }

  async retryLastCommand() {
    if (!this.lastFailedInput) {
      return;
    }

    const input = this.lastFailedInput;
    await this.submitInput(input);
  }

  /**
   * Sends the line exactly as typed. The server decides what it means and
   * answers with a turn, a refusal, a view to open, or quit; the browser only
   * shows what came back.
   */
  async submitInput(input: string) {
    if (!this.state || !this.game_id || this.status === 'loading' || this.awaitingReturnToList) {
      return;
    }

    // Acting from an old page returns the player to the live one, so the
    // result of what they just typed is what they see.
    this.goToLivePage();
    this.error = null;

    // Echoed before the answer so the player sees their own words while the
    // narrator is still writing. A line that opens the notebook leaves no trace
    // in the transcript, so that answer takes the echo back.
    const playedIn = this.state.mode;
    const echo = this.appendLine('input', INVESTIGATOR_SPEAKER, input);

    const answer = await this.send(
      'game-turn',
      { game_id: this.game_id, input },
      GameTurnResponseSchema,
      input,
    );
    if (answer && this.state) {
      this.showAnswer(answer, playedIn, echo);
    }
  }

  /**
   * Step into the starting location. The opening event only sets the scene; the
   * arrival narration is generated on demand so the player gets a beat to read
   * the premise first. `game-enter` is idempotent, so a second call while the
   * first is in flight cannot produce a duplicate page.
   */
  async enterStartingLocation() {
    if (!this.game_id || this.status === 'loading' || !this.awaitingOpeningConfirmation) {
      return;
    }

    const answer = await this.send(
      'game-enter',
      { game_id: this.game_id },
      GameEnterResponseSchema,
      null,
    );
    if (answer && this.state) {
      this.showArrival(answer);
    }
  }

  /**
   * One request the player is waiting on: retried while the failure is
   * transient, read through its schema, and answered on the transcript when it
   * fails. Returns what the schema accepted, or null once the failure is shown.
   * `input` is what a retry would resend; null for requests that have no line.
   */
  private async send<T>(
    endpoint: string,
    body: Record<string, unknown>,
    schema: ContractSchema<T>,
    input: string | null,
  ): Promise<T | null> {
    this.status = 'loading';
    this.isRetrying = false;
    this.retryCount = 0;

    const result = await callWithRetry(
      () => callApi(endpoint, body),
      (attempt) => {
        this.isRetrying = true;
        this.retryCount = attempt;
        this.appendSystemFeedback(`Something went wrong. Trying again (${attempt}/3)...`);
      },
    );

    this.isRetrying = false;
    this.retryCount = 0;
    this.status = 'active';

    if (!result.ok) {
      this.showFailure(result.failure, input);
      return null;
    }

    const answer = readContract(schema, result.data, endpoint);
    if (!answer.ok) {
      // Not offered for a retry: the turn may well have been saved, and a
      // second send would play it twice.
      this.error = answer.message;
      this.lastFailedInput = null;
      this.appendError(`${answer.message} ${UNREADABLE_NOTE}`);
      return null;
    }

    this.error = null;
    this.lastFailedInput = null;
    return answer.value;
  }

  private showFailure(failure: AttemptFailure, input: string | null) {
    if (failure.exhausted) {
      this.error = failure.message ?? 'Request failed after retries.';
      this.appendError('That did not work, even after 3 tries. Use [ RETRY LAST COMMAND ] to try again.');
    } else {
      this.error = failure.message ?? 'Request failed.';
      this.appendError(`Request failed: ${this.error}`);
    }
    this.lastFailedInput = input;
  }

  private showAnswer(answer: GameTurnResponse, playedIn: GameState['mode'], echo: number | null) {
    switch (answer.kind) {
      case 'turn':
        this.showTurn(answer, playedIn);
        return;
      case 'refused':
        this.appendSystemFeedback(answer.hint);
        return;
      case 'view':
        this.showView(answer, echo);
        return;
      case 'quit':
        this.showQuit();
        return;
    }
  }

  private showView(answer: TurnViewResponse, echo: number | null) {
    if (answer.view === 'help') {
      this.showHelp = true;
      this.appendSystemFeedback(HELP_NOTE);
      return;
    }

    this.removeEvent(echo);
    this.openNotebook(answer.section);
  }

  private showQuit() {
    if (this.state) {
      this.state.mode = 'ended';
    }

    this.isRetrying = false;
    this.retryCount = 0;
    this.lastFailedInput = null;
    this.accusationOutcome = null;
    this.awaitingReturnToList = true;
    this.appendSystemFeedback(QUIT_NOTE);
  }

  private showTurn(answer: TurnPlayedResponse, playedIn: GameState['mode']) {
    if (!this.state) {
      return;
    }

    this.applyPosition(answer.state);
    this.mergeDiscoveredClues(answer.revealed_clues);
    this.settleCase(answer.state.mode, answer.result);
    for (const line of linesOfTurn(answer, playedIn)) {
      this.appendEvent(line.event_type, line.narration_parts, line.payload);
    }
  }

  private showArrival(answer: GameEnterResponse) {
    if (!this.state) {
      return;
    }

    this.applyPosition({
      mode: answer.mode,
      time_remaining: answer.time_remaining,
      location: answer.current_location,
      current_talk_character: answer.current_talk_character ?? null,
    });
    this.settleCase(answer.mode, null);

    // The answer names the place by id; the page is labelled with its name.
    const place = this.state.locations.find((location) => location.id === answer.current_location);
    this.appendEvent('move', answer.narration_parts, {
      location_name: place?.name ?? answer.current_location,
    });
  }

  private applyPosition(position: Pick<GameState, 'mode' | 'time_remaining' | 'location' | 'current_talk_character'>) {
    if (!this.state) {
      return;
    }

    this.state.mode = position.mode;
    this.state.time_remaining = position.time_remaining;
    this.state.location = position.location;
    this.state.current_talk_character = position.current_talk_character;
  }

  /** The case is over only when a turn ended it with a verdict; any other turn leaves it open. */
  private settleCase(mode: GameState['mode'], result: 'win' | 'lose' | null) {
    if (mode === 'ended' && result) {
      this.accusationOutcome = result;
      this.awaitingReturnToList = true;
      this.viewerMode = 'read_only_completed';
      return;
    }

    this.accusationOutcome = null;
    this.awaitingReturnToList = false;
    this.viewerMode = 'interactive';
  }

  /** Merges the clues the notebook does not hold yet, and surfaces them for the discovery celebration. */
  private mergeDiscoveredClues(found: DiscoveredClue[]) {
    if (!this.state) {
      return;
    }

    const fresh = freshClues(this.state.discovered_clues, found);
    if (fresh.length === 0) {
      return;
    }

    this.state.discovered_clues.push(...fresh);
    this.recentlyDiscovered = fresh;
  }

  /**
   * Append an event to the history and return its sequence. Client-side lines
   * carry the same shape as the server's events so the page builder treats them
   * identically — they simply never open a new page.
   */
  private appendEvent(
    eventType: string,
    parts: NarrationPart[],
    payload?: Record<string, unknown> | null,
  ): number | null {
    if (!this.state) {
      return null;
    }

    const sequence = this.state.history.reduce((max, event) => Math.max(max, event.sequence), 0) + 1;
    this.state.history.push({
      sequence,
      event_type: eventType,
      narration_parts: parts,
      payload,
    });
    return sequence;
  }

  private appendLine(
    eventType: string,
    speaker: Speaker,
    text: string,
    payload?: Record<string, unknown>,
  ): number | null {
    return this.appendEvent(eventType, [{ text, speaker, image_id: null }], payload);
  }

  private removeEvent(sequence: number | null) {
    if (this.state && sequence !== null) {
      this.state.history = this.state.history.filter((event) => event.sequence !== sequence);
    }
  }

  private appendSystemFeedback(text: string) {
    this.appendLine('system_response', SYSTEM_SPEAKER, text);
  }

  private appendError(text: string) {
    this.appendLine('error', SYSTEM_SPEAKER, text);
  }

  clearSessionForMysteryList() {
    this.game_id = null;
    this.blueprint_id = null;
    this.state = null;
    this.status = 'idle';
    this.error = null;
    this.showHelp = false;
    this.showNotebook = false;
    this.notebookSection = DEFAULT_NOTEBOOK_SECTION;
    this.isRetrying = false;
    this.retryCount = 0;
    this.lastFailedInput = null;
    this.accusationOutcome = null;
    this.awaitingReturnToList = false;
    this.viewerMode = 'interactive';
    this.activePageIndex = null;
  }
}

export const gameSessionStore = new GameSessionStore();
