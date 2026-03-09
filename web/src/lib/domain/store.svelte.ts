import { supabase } from '../api/supabase';
import type { Blueprint, GameState, HistoryEntry, Speaker } from '../types/game';
import {
  createCharacterSpeaker,
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

interface BackendInvocation {
  endpoint: string;
  body: Record<string, unknown>;
}

export type ThemeName = 'matrix' | 'amber';

const THEME_STORAGE_KEY = 'mystery-theme';
const THEME_NAMES: ThemeName[] = ['matrix', 'amber'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && THEME_NAMES.includes(value as ThemeName);
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
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

export class GameSessionStore {
  game_id = $state<string | null>(null);
  status = $state<'idle' | 'loading' | 'active' | 'error'>('idle');
  state = $state<GameState | null>(null);
  error = $state<string | null>(null);
  blueprints = $state<Blueprint[]>([]);
  showHelp = $state(false);
  isRetrying = $state(false);
  retryCount = $state(0);
  lastFailedInput = $state<string | null>(null);
  accusationOutcome = $state<'win' | 'lose' | null>(null);
  awaitingReturnToList = $state(false);
  theme = $state<ThemeName>('matrix');

  initializeTheme() {
    if (typeof window === 'undefined') {
      return;
    }

    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeName(saved)) {
      this.theme = saved;
    }

    this.applyTheme();
  }

  setTheme(theme: ThemeName) {
    this.theme = theme;
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
      this.blueprints = data.blueprints;
      this.status = 'idle';
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
      this.state = this.normalizeState(response.state);
      this.lastFailedInput = null;
      this.accusationOutcome = null;
      this.awaitingReturnToList = false;
      this.status = 'active';
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

  private normalizeHistory(history: unknown): HistoryEntry[] {
    if (!Array.isArray(history)) {
      return [];
    }

    return history
      .filter((entry): entry is Record<string, unknown> => isRecord(entry))
      .map((entry, index) => ({
        sequence: readInt(entry.sequence, index + 1),
        event_type: readString(entry.event_type, 'event'),
        narration: readString(entry.narration),
        speaker: readSpeaker(entry.speaker, NARRATOR_SPEAKER),
      }))
      .filter((entry) => entry.narration.length > 0);
  }

  private normalizeState(rawState: unknown): GameState {
    const source = isRecord(rawState) ? rawState : {};
    const narration = readString(source.narration);
    const narrationSpeaker = readSpeaker(source.narration_speaker, NARRATOR_SPEAKER);
    const history = this.normalizeHistory(source.history);

    if (history.length === 0 && narration.length > 0) {
      history.push({
        sequence: 1,
        event_type: 'start',
        narration,
        speaker: narrationSpeaker,
      });
    }

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
      narration,
      narration_speaker: narrationSpeaker,
      history,
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

  private appendHistory(eventType: string, speaker: Speaker, narration: string) {
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
      narration,
      speaker,
    });
  }

  private appendSystemFeedback(narration: string) {
    this.appendHistory('system_response', SYSTEM_SPEAKER, narration);
  }

  private appendError(narration: string) {
    this.appendHistory('error', SYSTEM_SPEAKER, narration);
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

    if (result.commandType === 'talk') {
      return `Who do you want to talk to? Try: ${this.formatSuggestions(result.suggestions)}.`;
    }

    return `Who are you accusing? Try: ${this.formatSuggestions(result.suggestions)}.`;
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
    this.awaitingReturnToList = false;
    this.appendSystemFeedback("Session ended. Type 'help' for options or start a new game.");
  }

  clearSessionForMysteryList() {
    this.game_id = null;
    this.state = null;
    this.status = 'idle';
    this.error = null;
    this.showHelp = false;
    this.isRetrying = false;
    this.retryCount = 0;
    this.lastFailedInput = null;
    this.accusationOutcome = null;
    this.awaitingReturnToList = false;
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
        return {
          endpoint: 'game-accuse',
          body: { game_id: this.game_id, accused_character_id: command.accused_character_id },
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

  private resolveBackendSpeaker(payload: Record<string, unknown>, endpoint: string): Speaker {
    if (endpoint === 'game-ask') {
      const characterName = typeof payload.current_talk_character === 'string'
        ? payload.current_talk_character
        : this.state?.current_talk_character;

      if (characterName) {
        return readSpeaker(payload.speaker, createCharacterSpeaker(characterName));
      }
    }

    return readSpeaker(payload.speaker, NARRATOR_SPEAKER);
  }

  private applyBackendState(payload: Record<string, unknown>, endpoint: string, speaker: Speaker) {
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
    } else {
      this.accusationOutcome = null;
      this.awaitingReturnToList = false;
    }

    if (typeof payload.narration === 'string') {
      this.state.narration = payload.narration;
      this.state.narration_speaker = speaker;
    }
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
            const narration =
              typeof payload.narration === 'string'
                ? payload.narration
                : typeof payload.response === 'string'
                  ? payload.response
                  : 'Action completed.';
            const speaker = this.resolveBackendSpeaker(payload, invocation.endpoint);

            this.appendHistory(invocation.endpoint, speaker, narration);
            this.applyBackendState(payload, invocation.endpoint, speaker);
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
