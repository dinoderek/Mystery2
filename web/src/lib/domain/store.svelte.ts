import { callApi, callApiGet } from '../api/client';
import type {
  Blueprint,
  DiscoveredClue,
  GameState,
  NarrationEvent,
  NarrationPart,
  SessionCatalog,
  SessionOutcome,
  SessionSummary,
  Speaker,
} from '../types/game';
import {
  INVESTIGATOR_SPEAKER,
  NARRATOR_SPEAKER,
  readSpeaker,
  SYSTEM_SPEAKER,
} from './speaker';
import {
  parseCommand,
  type ActionCommand,
  type ParseContext,
  type ParseResult,
} from './parser';
import {
  getBackoffDelayMs,
  isTransientFailure,
  sleep,
  type InvokeFailure,
} from './store.retry';
import { buildSessionPages, type SessionPage } from './session-pages';
import { themeStore } from './theme-store.svelte';
import { DEFAULT_NOTEBOOK_SECTION, type NotebookSection } from './notebook';

interface BackendInvocation {
  endpoint: string;
  body: Record<string, unknown>;
  /**
   * The event type the backend persists for this action. The client stamps the
   * same value onto the optimistically appended event so a live session and a
   * resumed one produce identical pages.
   */
  eventType: string;
}

export type ThemeName = 'matrix' | 'amber';
export type SessionViewerMode = 'interactive' | 'read_only_completed';

const THEME_STORAGE_KEY = 'mystery-theme';
const THEME_NAMES: ThemeName[] = ['matrix', 'amber'];
const EMPTY_CATALOG: SessionCatalog = {
  in_progress: [],
  completed: [],
  counts: {
    in_progress: 0,
    completed: 0,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && THEME_NAMES.includes(value as ThemeName);
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readCharacterSex(value: unknown): 'male' | 'female' | null {
  return value === 'male' || value === 'female' ? value : null;
}

function readRecoveryMessage(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  return typeof value.recovery === 'string' ? value.recovery : null;
}

function readInt(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.trunc(value)
    : fallback;
}

function readMode(value: unknown, fallback: GameState['mode']): GameState['mode'] {
  if (value === 'explore' || value === 'talk' || value === 'accuse' || value === 'ended') {
    return value;
  }

  return fallback;
}

function readSessionMode(value: unknown): SessionSummary['mode'] {
  if (value === 'explore' || value === 'talk' || value === 'accuse' || value === 'ended') {
    return value;
  }

  return 'explore';
}

function readSessionOutcome(value: unknown): SessionOutcome {
  if (value === 'win' || value === 'lose') {
    return value;
  }

  return null;
}

function readTimestamp(value: unknown): string {
  if (typeof value !== 'string') {
    return new Date(0).toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(0).toISOString();
  }

  return parsed.toISOString();
}

function compareSessionSummaries(a: SessionSummary, b: SessionSummary): number {
  const byLastPlayed = b.last_played_at.localeCompare(a.last_played_at);
  if (byLastPlayed !== 0) {
    return byLastPlayed;
  }

  const byCreated = b.created_at.localeCompare(a.created_at);
  if (byCreated !== 0) {
    return byCreated;
  }

  return b.game_id.localeCompare(a.game_id);
}

export function sortSessionSummaries(summaries: SessionSummary[]): SessionSummary[] {
  return [...summaries].sort(compareSessionSummaries);
}

export function normalizeSessionSummary(raw: unknown): SessionSummary | null {
  if (!isRecord(raw)) {
    return null;
  }

  const gameId = readString(raw.game_id);
  const blueprintId = readString(raw.blueprint_id);
  if (gameId.length === 0 || blueprintId.length === 0) {
    return null;
  }

  const title = readString(raw.mystery_title, 'Unknown Mystery');
  const mysteryAvailable = typeof raw.mystery_available === 'boolean' ? raw.mystery_available : false;
  const canOpen = typeof raw.can_open === 'boolean' ? raw.can_open : mysteryAvailable;

  return {
    game_id: gameId,
    blueprint_id: blueprintId,
    mystery_title: title.length > 0 ? title : 'Unknown Mystery',
    mystery_available: mysteryAvailable,
    can_open: canOpen && mysteryAvailable,
    mode: readSessionMode(raw.mode),
    time_remaining: Math.max(0, readInt(raw.time_remaining)),
    outcome: readSessionOutcome(raw.outcome),
    last_played_at: readTimestamp(raw.last_played_at),
    created_at: readTimestamp(raw.created_at),
  };
}

function normalizeSessionSummaryList(raw: unknown): SessionSummary[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return sortSessionSummaries(
    raw
      .map((entry) => normalizeSessionSummary(entry))
      .filter((entry): entry is SessionSummary => entry !== null),
  );
}

export function normalizeSessionCatalog(raw: unknown): SessionCatalog {
  if (!isRecord(raw)) {
    return EMPTY_CATALOG;
  }

  const inProgress = normalizeSessionSummaryList(raw.in_progress);
  const completed = normalizeSessionSummaryList(raw.completed);

  return {
    in_progress: inProgress.filter((summary) => summary.mode !== 'ended'),
    completed: completed.filter((summary) => summary.mode === 'ended'),
    counts: {
      in_progress: inProgress.filter((summary) => summary.mode !== 'ended').length,
      completed: completed.filter((summary) => summary.mode === 'ended').length,
    },
  };
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
  theme = $state<ThemeName>('matrix');
  sessionCatalog = $state<SessionCatalog>(EMPTY_CATALOG);
  sessionCatalogStatus = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  sessionCatalogError = $state<string | null>(null);
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

  initializeTheme() {
    if (typeof window === 'undefined') {
      return;
    }

    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeName(saved)) {
      this.theme = saved;
    } else {
      this.theme = themeStore.getActiveTheme().id === 'amber' ? 'amber' : 'matrix';
    }

    this.applyTheme();
  }

  setTheme(theme: ThemeName, syncPalette = true) {
    this.theme = theme;
    if (syncPalette) {
      themeStore.setTheme(theme === 'amber' ? 'amber' : 'classic');
    }
    this.applyTheme();
  }

  private applyTheme() {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }

    document.documentElement.setAttribute('data-theme', this.theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, this.theme);
  }

  async loadBlueprints() {
    this.status = 'loading';
    const { data, error } = await callApi('blueprints-list');
    if (error) {
      this.error = error.message;
      this.status = 'error';
    } else {
      const payload = isRecord(data) ? data : {};
      const rawBlueprints = Array.isArray(payload.blueprints) ? payload.blueprints : [];
      this.blueprints = rawBlueprints
        .filter((entry): entry is Record<string, unknown> => isRecord(entry))
        .map((entry) => ({
          id: readString(entry.id),
          title: readString(entry.title),
          one_liner: readString(entry.one_liner),
          target_age: readInt(entry.target_age),
          blueprint_image_id: readNullableString(entry.blueprint_image_id),
        }))
        .filter((entry) => entry.id.length > 0);

      this.status = 'idle';
    }
  }

  async loadSessionCatalog(force = false) {
    if (this.sessionCatalogStatus === 'loading') {
      return;
    }
    if (!force && this.sessionCatalogStatus === 'ready') {
      return;
    }

    this.sessionCatalogStatus = 'loading';
    this.sessionCatalogError = null;

    const { data, error } = await callApi('game-sessions-list');
    if (error) {
      this.sessionCatalog = EMPTY_CATALOG;
      this.sessionCatalogError = error.message;
      this.sessionCatalogStatus = 'error';
      return;
    }

    this.sessionCatalog = normalizeSessionCatalog(data);
    this.sessionCatalogStatus = 'ready';
  }

  async startGame(blueprintId: string) {
    this.status = 'loading';
    const { data, error } = await callApi('game-start', { blueprint_id: blueprintId });
    if (error) {
      this.error = error.message;
      this.status = 'error';
    } else {
      const response = isRecord(data) ? data : {};
      this.game_id = typeof response.game_id === 'string' ? response.game_id : null;
      this.blueprint_id = blueprintId;
      this.state = this.normalizeState(response.state, response.narration_events);
      this.lastFailedInput = null;
      this.accusationOutcome = null;
      this.awaitingReturnToList = false;
      this.viewerMode = 'interactive';
      this.showHelp = false;
      this.showNotebook = false;
      this.notebookSection = DEFAULT_NOTEBOOK_SECTION;
      this.status = 'active';
    }
  }

  private async loadPersistedState(gameId: string): Promise<unknown> {
    const { data, error } = await callApiGet('game-get', { game_id: gameId });

    if (error) {
      // `game-get` returns a `details.recovery` hint for the failures a player
      // can do something about; it is worth more than the bare error.
      const recovery = isRecord(data) ? readRecoveryMessage(data.details) : null;
      throw new Error(recovery ? `${error.message}. ${recovery}` : error.message);
    }

    return data;
  }

  async resumeSession(gameId: string) {
    this.status = 'loading';
    this.error = null;

    try {
      const data = await this.loadPersistedState(gameId);
      const response = isRecord(data) ? data : {};
      this.game_id = gameId;
      this.blueprint_id = typeof response.blueprint_id === 'string' ? response.blueprint_id : null;
      this.state = this.normalizeState(response.state, response.narration_events);
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.error = message;
      this.status = 'idle';
    }
  }

  async retryLastCommand() {
    if (!this.lastFailedInput) {
      return;
    }

    const input = this.lastFailedInput;
    await this.submitInput(input);
  }

  async submitInput(input: string) {
    if (!this.state || !this.game_id || this.status === 'loading' || this.awaitingReturnToList) {
      return;
    }

    // Acting from an old page returns the player to the live one, so the
    // result of what they just typed is what they see.
    this.goToLivePage();

    const parseContext = this.getParseContext();
    const parsed = parseCommand(input, this.state.mode, parseContext);

    this.error = null;

    if (parsed.type === 'theme-list') {
      const names = themeStore.getThemeList().map((t) => t.name).join(', ');
      const active = themeStore.getActiveThemeName();
      this.appendSystemFeedback(`Themes: ${names}. Active: ${active}.`);
      return;
    }

    if (parsed.type === 'theme-set') {
      const success = themeStore.setTheme(parsed.themeName);
      if (success) {
        const activeThemeId = themeStore.getActiveTheme().id;
        this.setTheme(activeThemeId === 'amber' ? 'amber' : 'matrix', false);
        this.appendSystemFeedback(`Theme: ${themeStore.getActiveThemeName()}.`);
      } else {
        const names = themeStore.getThemeList().map((t) => t.name.toLowerCase()).join(', ');
        this.appendSystemFeedback(`Unknown theme "${parsed.themeName}". Available: ${names}.`);
      }
      return;
    }

    // Above the input echo on purpose: opening the notebook costs no turn and
    // leaves no trace in the transcript.
    if (parsed.type === 'notebook') {
      this.openNotebook(parsed.section);
      return;
    }

    this.appendLine('input', INVESTIGATOR_SPEAKER, input);

    switch (parsed.type) {
      case 'help':
        this.showHelp = true;
        this.appendSystemFeedback('Help menu opened.');
        return;
      case 'quit':
        this.handleQuitCommand();
        return;
      case 'missing-target':
        this.appendSystemFeedback(this.formatMissingTargetMessage(parsed));
        return;
      case 'invalid-target':
        this.appendSystemFeedback(this.formatInvalidTargetMessage(parsed));
        return;
      case 'unrecognized':
        this.appendSystemFeedback(parsed.hint);
        return;
      case 'valid':
        await this.submitValidCommand(parsed.command, input);
        return;
      default:
        this.appendError('Unable to parse command.');
    }
  }

  private readNarrationPart(raw: unknown): NarrationPart | null {
    if (!isRecord(raw)) {
      return null;
    }

    const text = readString(raw.text);
    if (!text) {
      return null;
    }

    return {
      text,
      speaker: readSpeaker(raw.speaker, NARRATOR_SPEAKER),
      image_id: readNullableString(raw.image_id),
    };
  }

  private normalizeNarrationEvents(raw: unknown): NarrationEvent[] {
    if (!Array.isArray(raw)) {
      return [];
    }

    const normalized: Array<NarrationEvent | null> = raw
      .filter((entry): entry is Record<string, unknown> => isRecord(entry))
      .map((entry, index) => {
        const narrationParts = Array.isArray(entry.narration_parts)
          ? entry.narration_parts
              .map((part) => this.readNarrationPart(part))
              .filter((part): part is NarrationPart => part !== null)
          : [];

        if (narrationParts.length === 0) {
          return null;
        }

        return {
          sequence: readInt(entry.sequence, index + 1),
          event_type: readString(entry.event_type, 'event'),
          narration_parts: narrationParts,
          payload: isRecord(entry.payload) ? entry.payload : undefined,
          created_at: typeof entry.created_at === 'string' ? entry.created_at : undefined,
        };
      });

    return normalized.filter((entry): entry is NarrationEvent => entry !== null);
  }

  private mergeDiscoveredClues(raw: unknown) {
    if (!this.state) {
      return;
    }
    const incoming = this.normalizeDiscoveredClues(raw);
    if (incoming.length === 0) {
      return;
    }
    const known = new Set(this.state.discovered_clues.map((clue) => clue.id));
    const fresh: DiscoveredClue[] = [];
    for (const clue of incoming) {
      if (!known.has(clue.id)) {
        known.add(clue.id);
        this.state.discovered_clues.push(clue);
        fresh.push(clue);
      }
    }
    // Surface only the genuinely new clues for the discovery celebration.
    if (fresh.length > 0) {
      this.recentlyDiscovered = fresh;
    }
  }

  private normalizeState(rawState: unknown, rawNarrationEvents: unknown = []): GameState {
    const source = isRecord(rawState) ? rawState : {};
    const narrationEvents = this.normalizeNarrationEvents(rawNarrationEvents);

    return {
      mystery_summary: readNullableString(source.mystery_summary),
      premise: readNullableString(source.premise),
      locations: Array.isArray(source.locations)
        ? source.locations
            .filter((location): location is Record<string, unknown> => isRecord(location))
            .map((location) => ({
              id: readString(location.id),
              name: readString(location.name),
              summary: readNullableString(location.summary),
            }))
            .filter((location) => location.name.length > 0)
        : [],
      characters: Array.isArray(source.characters)
        ? source.characters
            .filter((character): character is Record<string, unknown> => isRecord(character))
            .map((character) => ({
              id: readString(character.id),
              first_name: readString(character.first_name),
              last_name: readString(character.last_name),
              location_name: readString(character.location_name) || readString(character.location_id),
              sex: readCharacterSex(character.sex),
              summary: readNullableString(character.summary),
            }))
            .filter((character) => character.first_name.length > 0)
        : [],
      discovered_clues: this.normalizeDiscoveredClues(source.discovered_clues),
      time_remaining: readInt(source.time_remaining),
      location: readString(source.location),
      mode: readMode(source.mode, 'explore'),
      current_talk_character:
        typeof source.current_talk_character === 'string' ? source.current_talk_character : null,
      history: narrationEvents,
    };
  }

  private normalizeDiscoveredClues(raw: unknown): DiscoveredClue[] {
    if (!Array.isArray(raw)) return [];
    const clues: DiscoveredClue[] = [];
    for (const entry of raw) {
      if (!isRecord(entry)) continue;
      const id = readString(entry.id);
      const text = readString(entry.text);
      if (id.length === 0 || text.length === 0) continue;
      const origin = isRecord(entry.origin) ? entry.origin : {};
      // `entry.threads` is ignored on purpose: older sessions and any stale
      // payload may still carry spoiler-bearing thread labels, and nothing in
      // the client may surface them.
      clues.push({
        id,
        text,
        source: entry.source === 'talk' ? 'talk' : 'search',
        origin:
          origin.kind === 'character'
            ? {
                kind: 'character',
                character_id: readString(origin.character_id),
                character_name: readString(origin.character_name),
              }
            : {
                kind: 'location',
                location_id: readString(origin.location_id),
                location_name: readString(origin.location_name),
              },
        discovered_at: typeof entry.discovered_at === 'string' ? entry.discovered_at : null,
        off_script: entry.off_script === true,
      });
    }
    return clues;
  }

  private getParseContext(): ParseContext {
    if (!this.state) {
      return {
        locations: [],
        characters: [],
        currentLocation: '',
      };
    }

    return {
      locations: this.state.locations,
      characters: this.state.characters,
      currentLocation: this.state.location,
    };
  }

  /**
   * Append a client-side event to the history. Client events carry the same
   * shape as backend narration events so the page builder can treat them
   * identically -- they simply never open a new page.
   */
  private appendEvent(
    eventType: string,
    parts: NarrationPart[],
    payload?: Record<string, unknown>,
  ) {
    if (!this.state) {
      return;
    }

    if (!this.state.history) {
      this.state.history = [];
    }

    const currentSequence = this.state.history.reduce((max, event) => {
      return event.sequence > max ? event.sequence : max;
    }, 0);

    this.state.history.push({
      sequence: currentSequence + 1,
      event_type: eventType,
      narration_parts: parts,
      payload,
    });
  }

  private appendLine(
    eventType: string,
    speaker: Speaker,
    text: string,
    payload?: Record<string, unknown>,
  ) {
    this.appendEvent(eventType, [{ text, speaker, image_id: null }], payload);
  }

  /**
   * The naming half of a backend event's payload, rebuilt client-side. The
   * server stores it on the persisted event, so without this a page would be
   * labelled "Location" while playing and "Gull Cry Dock" after a resume.
   */
  private buildEventPayload(eventType: string): Record<string, unknown> | undefined {
    if (!this.state) {
      return undefined;
    }

    if (eventType === 'talk' || eventType === 'ask') {
      // `current_talk_character` echoes however the player typed the name, so
      // resolve it against the cast to match what the server persists.
      const active = this.state.current_talk_character;
      if (!active) {
        return undefined;
      }
      const match = this.state.characters.find(
        (character) =>
          character.id === active ||
          character.first_name.toLowerCase() === active.toLowerCase(),
      );
      return { character_name: match?.first_name ?? active };
    }

    if (eventType === 'move' || eventType === 'end_talk') {
      const current = this.state.location;
      const name = this.state.locations.find((l) => l.id === current)?.name ?? current;
      return name ? { location_name: name } : undefined;
    }

    return undefined;
  }

  private appendSystemFeedback(text: string) {
    this.appendLine('system_response', SYSTEM_SPEAKER, text);
  }

  private appendError(text: string) {
    this.appendLine('error', SYSTEM_SPEAKER, text);
  }

  private formatSuggestions(suggestions: string[]): string {
    if (suggestions.length === 0) {
      return 'none available right now';
    }
    return suggestions.join(', ');
  }

  private formatMissingTargetMessage(result: Extract<ParseResult, { type: 'missing-target' }>): string {
    if (result.commandType === 'move') {
      return `Where to? Try: ${this.formatSuggestions(result.suggestions)}.`;
    }

    return `Who do you want to talk to? Try: ${this.formatSuggestions(result.suggestions)}.`;
  }

  private formatInvalidTargetMessage(result: Extract<ParseResult, { type: 'invalid-target' }>): string {
    const targetLabel = result.commandType === 'move' ? 'destination' : 'character';
    return `"${result.attempted}" is not a valid ${targetLabel}. Try: ${this.formatSuggestions(result.suggestions)}.`;
  }

  private handleQuitCommand() {
    if (this.state) {
      this.state.mode = 'ended';
    }

    this.isRetrying = false;
    this.retryCount = 0;
    this.lastFailedInput = null;
    this.accusationOutcome = null;
    this.awaitingReturnToList = true;
    this.appendSystemFeedback(
      'This case is over. Press Tab to review your notebook, or any other key to go back to the list of mysteries.',
    );
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

  private getBackendInvocation(command: ActionCommand): BackendInvocation {
    if (!this.game_id) {
      throw new Error('Cannot submit command without an active game.');
    }

    switch (command.type) {
      case 'move':
        return {
          endpoint: 'game-move',
          body: { game_id: this.game_id, destination: command.destination },
          eventType: 'move',
        };
      case 'search':
        return {
          endpoint: 'game-search',
          body: { game_id: this.game_id, search_query: command.query },
          eventType: 'search',
        };
      case 'talk':
        return {
          endpoint: 'game-talk',
          body: { game_id: this.game_id, character_id: command.character_id },
          eventType: 'talk',
        };
      case 'ask':
        if (this.state?.mode === 'accuse') {
          return {
            endpoint: 'game-accuse',
            body: { game_id: this.game_id, player_reasoning: command.question },
            eventType: 'accuse_round',
          };
        }
        return {
          endpoint: 'game-ask',
          body: { game_id: this.game_id, player_input: command.question },
          eventType: 'ask',
        };
      case 'end_talk':
        return {
          endpoint: 'game-end-talk',
          body: { game_id: this.game_id },
          eventType: 'end_talk',
        };
      case 'accuse':
        // Both forms of `accuse` open the accusation, so both open its page.
        return command.reasoning
          ? {
          endpoint: 'game-accuse',
          body: { game_id: this.game_id, player_reasoning: command.reasoning },
          eventType: 'accuse_start',
        }
          : {
          endpoint: 'game-accuse',
          body: { game_id: this.game_id },
          eventType: 'accuse_start',
        };
      default:
        throw new Error('Unsupported command.');
    }
  }

  private toInvokeFailure(error: unknown): InvokeFailure {
    if (!error || typeof error !== 'object') {
      return { message: error ? String(error) : null };
    }

    const typed = error as {
      message?: string;
      status?: number;
      context?: { status?: number };
    };

    const contextStatus = typed.context && typeof typed.context.status === 'number' ? typed.context.status : undefined;

    return {
      message: typed.message ?? String(error),
      status: typeof typed.status === 'number' ? typed.status : contextStatus,
    };
  }

  private readNarrationPartsFromPayload(payload: Record<string, unknown>): NarrationPart[] {
    if (!Array.isArray(payload.narration_parts)) {
      return [];
    }

    return payload.narration_parts
      .map((part) => this.readNarrationPart(part))
      .filter((part): part is NarrationPart => part !== null);
  }

  private applyBackendState(payload: Record<string, unknown>, endpoint: string) {
    if (!this.state) {
      return;
    }

    this.state.mode = readMode(payload.mode, endpoint === 'game-accuse' ? 'ended' : this.state.mode);

    if (typeof payload.time_remaining === 'number') {
      this.state.time_remaining = Math.trunc(payload.time_remaining);
    }

    if (typeof payload.current_location === 'string') {
      this.state.location = payload.current_location;

      if (Array.isArray(payload.visible_characters)) {
        const visible = new Set(
          payload.visible_characters
            .map((value) => {
              if (typeof value === 'string') {
                return value.toLowerCase();
              }

              if (isRecord(value) && typeof value.first_name === 'string') {
                return value.first_name.toLowerCase();
              }

              return null;
            })
            .filter((value): value is string => Boolean(value)),
        );

        for (const character of this.state.characters) {
          if (visible.has(character.first_name.toLowerCase())) {
            character.location_name = payload.current_location;
          }
        }
      }
    }

    if (typeof payload.current_talk_character === 'string' || payload.current_talk_character === null) {
      this.state.current_talk_character = payload.current_talk_character;
    }

    // Newly discovered clues from a search/ask turn: merge the unseen ones into
    // the notebook and surface them for the discovery celebration.
    this.mergeDiscoveredClues(payload.revealed_clues);

    const outcome = payload.result;
    const isAccuseEnded = endpoint === 'game-accuse' && payload.mode === 'ended';
    if (isAccuseEnded && (outcome === 'win' || outcome === 'lose')) {
      this.accusationOutcome = outcome;
      this.awaitingReturnToList = true;
      this.viewerMode = 'read_only_completed';
    } else {
      this.accusationOutcome = null;
      this.awaitingReturnToList = false;
      this.viewerMode = 'interactive';
    }
  }

  private async submitValidCommand(command: ActionCommand, rawInput: string) {
    await this.runInvocation(this.getBackendInvocation(command), rawInput);
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

    await this.runInvocation(
      {
        endpoint: 'game-enter',
        body: { game_id: this.game_id },
        eventType: 'move',
      },
      null,
    );
  }

  private async runInvocation(invocation: BackendInvocation, rawInput: string | null) {
    const maxAttempts = 3;

    this.status = 'loading';
    this.isRetrying = false;
    this.retryCount = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const { data, error } = await callApi(invocation.endpoint, invocation.body);

        if (!error) {
          this.error = null;
          this.lastFailedInput = null;
          this.isRetrying = false;
          this.retryCount = 0;

          if (data && typeof data === 'object') {
            const payload = data as Record<string, unknown>;
            const narrationParts = this.readNarrationPartsFromPayload(payload);

            // State first: the event's own payload names the place or person
            // this turn moved to, and that is only known once applied.
            this.applyBackendState(payload, invocation.endpoint);
            const eventPayload = this.buildEventPayload(invocation.eventType);

            if (narrationParts.length > 0) {
              this.appendEvent(invocation.eventType, narrationParts, eventPayload);
            } else {
              this.appendLine(
                invocation.eventType,
                NARRATOR_SPEAKER,
                'Action completed.',
                eventPayload,
              );
            }
          }

          this.status = 'active';
          return;
        }

        const failure = this.toInvokeFailure(error);
        const transient = isTransientFailure(failure);

        if (!transient) {
          this.error = failure.message ?? 'Request failed.';
          this.appendError(`Request failed: ${this.error}`);
          this.lastFailedInput = rawInput;
          this.isRetrying = false;
          this.retryCount = 0;
          this.status = 'active';
          return;
        }

        if (attempt === maxAttempts) {
          this.error = failure.message ?? 'Request failed after retries.';
          this.appendError('That did not work, even after 3 tries. Use [ RETRY LAST COMMAND ] to try again.');
          this.lastFailedInput = rawInput;
          this.isRetrying = false;
          this.retryCount = 0;
          this.status = 'active';
          return;
        }

        this.isRetrying = true;
        this.retryCount = attempt;
        this.appendSystemFeedback(`Something went wrong. Trying again (${attempt}/3)...`);
        await sleep(getBackoffDelayMs(attempt));
      } catch (thrownError) {
        const transient = isTransientFailure(null, thrownError);
        const message = thrownError instanceof Error ? thrownError.message : String(thrownError);

        if (!transient) {
          this.error = message;
          this.appendError(`Request failed: ${message}`);
          this.lastFailedInput = rawInput;
          this.isRetrying = false;
          this.retryCount = 0;
          this.status = 'active';
          return;
        }

        if (attempt === maxAttempts) {
          this.error = message;
          this.appendError('That did not work, even after 3 tries. Use [ RETRY LAST COMMAND ] to try again.');
          this.lastFailedInput = rawInput;
          this.isRetrying = false;
          this.retryCount = 0;
          this.status = 'active';
          return;
        }

        this.isRetrying = true;
        this.retryCount = attempt;
        this.appendSystemFeedback(`Something went wrong. Trying again (${attempt}/3)...`);
        await sleep(getBackoffDelayMs(attempt));
      }
    }

    this.status = 'active';
  }
}

export const gameSessionStore = new GameSessionStore();
