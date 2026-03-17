import { supabase } from '../api/supabase';
import { resolveImageLink, type ImagePurpose } from '../api/images';
import type {
  Blueprint,
  GameState,
  HistoryEntry,
  NarrationEvent,
  NarrationPart,
  SessionCatalog,
  SessionOutcome,
  SessionSummary,
  Speaker,
  StoryImageState,
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
  type ListItem,
  type ParseContext,
  type ParseResult,
} from './parser';
import {
  getBackoffDelayMs,
  isTransientFailure,
  sleep,
  type InvokeFailure,
} from './store.retry';
import { themeStore } from './theme-store.svelte';

interface BackendInvocation {
  endpoint: string;
  body: Record<string, unknown>;
}

export type ThemeName = 'matrix' | 'amber';
export type SessionViewerMode = 'interactive' | 'read_only_completed';

const THEME_STORAGE_KEY = 'mystery-theme';
const THEME_NAMES: ThemeName[] = ['matrix', 'amber'];
const FUNCTIONS_BASE_URL = `${import.meta.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54331'}/functions/v1`;
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
  activeStoryImage = $state<StoryImageState | null>(null);
  showHelp = $state(false);
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
    const { data, error } = await supabase.functions.invoke('blueprints-list');
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
          blueprint_image_url: null,
          blueprint_image_expires_at: null,
          blueprint_image_placeholder: false,
        }))
        .filter((entry) => entry.id.length > 0);

      await this.hydrateBlueprintImageLinks();
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

    const { data, error } = await supabase.functions.invoke('game-sessions-list');
    if (error) {
      this.sessionCatalog = EMPTY_CATALOG;
      this.sessionCatalogError = error.message;
      this.sessionCatalogStatus = 'error';
      return;
    }

    this.sessionCatalog = normalizeSessionCatalog(data);
    this.sessionCatalogStatus = 'ready';
  }

  private async hydrateBlueprintImageLinks() {
    for (const [index, blueprint] of this.blueprints.entries()) {
      if (!blueprint.blueprint_image_id) {
        continue;
      }

      const resolved = await resolveImageLink({
        blueprintId: blueprint.id,
        imageId: blueprint.blueprint_image_id,
        purpose: 'blueprint_cover',
      });

      this.blueprints[index] = {
        ...blueprint,
        blueprint_image_url: resolved.url,
        blueprint_image_expires_at: resolved.expiresAt,
        blueprint_image_placeholder: resolved.placeholder,
      };
    }
  }

  async startGame(blueprintId: string) {
    this.status = 'loading';
    const { data, error } = await supabase.functions.invoke('game-start', {
      body: { blueprint_id: blueprintId },
    });
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
      await this.refreshStoryImageFromHistory();
      this.status = 'active';
    }
  }

  private async loadPersistedState(gameId: string): Promise<unknown> {
    const headers = new Headers();

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers.set('Authorization', `Bearer ${session.access_token}`);
    }

    const response = await fetch(
      `${FUNCTIONS_BASE_URL}/game-get?game_id=${encodeURIComponent(gameId)}`,
      {
        method: 'GET',
        headers,
      },
    );

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      if (isRecord(payload) && typeof payload.error === 'string') {
        const recovery = readRecoveryMessage(payload.details);
        throw new Error(recovery ? `${payload.error}. ${recovery}` : payload.error);
      }

      throw new Error(`Failed to load session (${response.status})`);
    }

    return response.json();
  }

  async resumeSession(gameId: string) {
    this.status = 'loading';
    this.error = null;

    try {
      const data = await this.loadPersistedState(gameId);
      const response = isRecord(data) ? data : {};
      this.game_id = gameId;
      this.state = this.normalizeState(response.state, response.narration_events);
      this.lastFailedInput = null;
      this.isRetrying = false;
      this.retryCount = 0;
      this.showHelp = false;
      await this.refreshStoryImageFromHistory();

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

    this.appendHistory('input', INVESTIGATOR_SPEAKER, input);

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
      case 'list':
        this.appendSystemFeedback(this.formatListMessage(parsed));
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

  private flattenNarrationEvents(events: NarrationEvent[]): HistoryEntry[] {
    return events.flatMap((event) =>
      event.narration_parts.map((part) => ({
        sequence: event.sequence,
        event_type: event.event_type,
        text: part.text,
        speaker: part.speaker,
        image_id: part.image_id ?? null,
      })),
    );
  }

  private normalizeState(rawState: unknown, rawNarrationEvents: unknown = []): GameState {
    const source = isRecord(rawState) ? rawState : {};
    const narrationEvents = this.normalizeNarrationEvents(rawNarrationEvents);

    return {
      locations: Array.isArray(source.locations)
        ? source.locations
            .filter((location): location is Record<string, unknown> => isRecord(location))
            .map((location) => ({ name: readString(location.name) }))
            .filter((location) => location.name.length > 0)
        : [],
      characters: Array.isArray(source.characters)
        ? source.characters
            .filter((character): character is Record<string, unknown> => isRecord(character))
            .map((character) => ({
              first_name: readString(character.first_name),
              last_name: readString(character.last_name),
              location_name: readString(character.location_name),
            }))
            .filter((character) => character.first_name.length > 0)
        : [],
      time_remaining: readInt(source.time_remaining),
      location: readString(source.location),
      mode: readMode(source.mode, 'explore'),
      current_talk_character:
        typeof source.current_talk_character === 'string' ? source.current_talk_character : null,
      history: this.flattenNarrationEvents(narrationEvents),
    };
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

  private appendHistory(eventType: string, speaker: Speaker, text: string, imageId: string | null = null) {
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
      text,
      speaker,
      image_id: imageId,
    });
  }

  private appendNarrationParts(eventType: string, parts: NarrationPart[]) {
    for (const part of parts) {
      this.appendHistory(eventType, part.speaker, part.text, part.image_id ?? null);
    }
  }

  private appendSystemFeedback(text: string) {
    this.appendHistory('system_response', SYSTEM_SPEAKER, text);
  }

  private appendError(text: string) {
    this.appendHistory('error', SYSTEM_SPEAKER, text);
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

  private formatListMessage(result: Extract<ParseResult, { type: 'list' }>): string {
    if (result.listType === 'locations') {
      const locationItems = result.items.filter(
        (item): item is Extract<ListItem, { kind: 'location' }> => item.kind === 'location',
      );

      if (locationItems.length === 0) {
        return 'Locations: none available.';
      }

      const rendered = locationItems.map((location) => {
        if (location.characters.length === 0) {
          return `${location.name} (no one here)`;
        }

        return `${location.name} (${location.characters.join(', ')})`;
      });

      return `Locations: ${rendered.join(' | ')}`;
    }

    const characterItems = result.items.filter(
      (item): item is Extract<ListItem, { kind: 'character' }> => item.kind === 'character',
    );

    if (characterItems.length === 0) {
      return 'Characters here: none.';
    }

    return `Characters here: ${characterItems.map((item) => item.displayName).join(', ')}`;
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
    this.appendSystemFeedback('Session ended. Press any key to go back to the mystery list.');
  }

  clearSessionForMysteryList() {
    this.game_id = null;
    this.blueprint_id = null;
    this.state = null;
    this.status = 'idle';
    this.error = null;
    this.showHelp = false;
    this.isRetrying = false;
    this.retryCount = 0;
    this.lastFailedInput = null;
    this.accusationOutcome = null;
    this.awaitingReturnToList = false;
    this.viewerMode = 'interactive';
    this.activeStoryImage = null;
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
        };
      case 'search':
        return {
          endpoint: 'game-search',
          body: { game_id: this.game_id },
        };
      case 'talk':
        return {
          endpoint: 'game-talk',
          body: { game_id: this.game_id, character_name: command.character_name },
        };
      case 'ask':
        if (this.state?.mode === 'accuse') {
          return {
            endpoint: 'game-accuse',
            body: { game_id: this.game_id, player_reasoning: command.question },
          };
        }
        return {
          endpoint: 'game-ask',
          body: { game_id: this.game_id, player_input: command.question },
        };
      case 'end_talk':
        return {
          endpoint: 'game-end-talk',
          body: { game_id: this.game_id },
        };
      case 'accuse':
        return command.reasoning
          ? {
          endpoint: 'game-accuse',
          body: { game_id: this.game_id, player_reasoning: command.reasoning },
        }
          : {
          endpoint: 'game-accuse',
          body: { game_id: this.game_id },
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

  private inferImagePurpose(entry: HistoryEntry): ImagePurpose {
    if (entry.event_type === 'start') {
      return 'blueprint_cover';
    }

    if (entry.event_type === 'talk' || entry.event_type === 'ask') {
      return 'character_portrait';
    }

    return 'location_scene';
  }

  private inferStoryImageTitle(entry: HistoryEntry): string {
    if (entry.event_type === 'start') {
      const blueprint = this.blueprints.find((candidate) => candidate.id === this.blueprint_id);
      return blueprint ? `${blueprint.title} cover` : 'Mystery cover';
    }

    if (entry.event_type === 'talk' || entry.event_type === 'ask') {
      const speakerLabel = entry.speaker.label || this.state?.current_talk_character || 'Character';
      return `${speakerLabel} portrait`;
    }

    const location = this.state?.location || 'Location';
    return `${location} scene`;
  }

  private async refreshStoryImageFromHistory() {
    if (!this.blueprint_id || !this.state) {
      this.activeStoryImage = null;
      return;
    }

    const latestWithImage = [...this.state.history].reverse().find((entry) => entry.image_id);
    if (!latestWithImage?.image_id) {
      this.activeStoryImage = null;
      return;
    }

    const purpose = this.inferImagePurpose(latestWithImage);
    const title = this.inferStoryImageTitle(latestWithImage);
    this.activeStoryImage = {
      kind:
        purpose === 'blueprint_cover'
          ? 'blueprint'
          : purpose === 'character_portrait'
            ? 'character'
            : 'location',
      title,
      image_id: latestWithImage.image_id,
      image_url: null,
      expires_at: null,
      placeholder: false,
      loading: true,
    };

    const resolved = await resolveImageLink({
      blueprintId: this.blueprint_id,
      imageId: latestWithImage.image_id,
      purpose,
    });

    this.activeStoryImage = {
      kind:
        purpose === 'blueprint_cover'
          ? 'blueprint'
          : purpose === 'character_portrait'
            ? 'character'
            : 'location',
      title,
      image_id: latestWithImage.image_id,
      image_url: resolved.url,
      expires_at: resolved.expiresAt,
      placeholder: resolved.placeholder,
      loading: false,
    };
  }

  private async submitValidCommand(command: ActionCommand, rawInput: string) {
    const invocation = this.getBackendInvocation(command);
    const maxAttempts = 3;

    this.status = 'loading';
    this.isRetrying = false;
    this.retryCount = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const { data, error } = await supabase.functions.invoke(invocation.endpoint, {
          body: invocation.body,
        });

        if (!error) {
          this.error = null;
          this.lastFailedInput = null;
          this.isRetrying = false;
          this.retryCount = 0;

          if (data && typeof data === 'object') {
            const payload = data as Record<string, unknown>;
            const narrationParts = this.readNarrationPartsFromPayload(payload);

            if (narrationParts.length > 0) {
              this.appendNarrationParts(invocation.endpoint, narrationParts);
            } else {
              this.appendHistory(invocation.endpoint, NARRATOR_SPEAKER, 'Action completed.');
            }

            this.applyBackendState(payload, invocation.endpoint);
            await this.refreshStoryImageFromHistory();
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
          this.appendError('Request failed after 3 attempts. Use [ RETRY LAST COMMAND ] to try again.');
          this.lastFailedInput = rawInput;
          this.isRetrying = false;
          this.retryCount = 0;
          this.status = 'active';
          return;
        }

        this.isRetrying = true;
        this.retryCount = attempt;
        this.appendSystemFeedback(`Connection issue. Retrying (${attempt}/3)...`);
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
          this.appendError('Request failed after 3 attempts. Use [ RETRY LAST COMMAND ] to try again.');
          this.lastFailedInput = rawInput;
          this.isRetrying = false;
          this.retryCount = 0;
          this.status = 'active';
          return;
        }

        this.isRetrying = true;
        this.retryCount = attempt;
        this.appendSystemFeedback(`Connection issue. Retrying (${attempt}/3)...`);
        await sleep(getBackoffDelayMs(attempt));
      }
    }

    this.status = 'active';
  }
}

export const gameSessionStore = new GameSessionStore();
