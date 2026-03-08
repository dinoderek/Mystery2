import { supabase } from '../api/supabase';
import type { Blueprint, GameState } from '../types/game';
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
      this.game_id = data.game_id;
      this.state = data.state;
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
    this.appendHistory('input', 'player', input);

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

  private appendHistory(eventType: string, actor: 'player' | 'system', narration: string) {
    if (!this.state) {
      return;
    }

    if (!this.state.history) {
      this.state.history = [];
    }

    this.state.history.push({
      sequence: this.state.history.length + 1,
      event_type: eventType,
      actor,
      narration,
    });
  }

  private appendSystemFeedback(narration: string) {
    this.appendHistory('system_response', 'system', narration);
  }

  private appendError(narration: string) {
    this.appendHistory('error', 'system', narration);
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

  private applyBackendState(data: Record<string, unknown>, endpoint: string) {
    if (!this.state) {
      return;
    }

    if (typeof data.mode === 'string') {
      this.state.mode = data.mode as GameState['mode'];
    } else if (endpoint === 'game-accuse') {
      this.state.mode = 'ended';
    }

    if (typeof data.time_remaining === 'number') {
      this.state.time_remaining = data.time_remaining;
    }

    if (typeof data.current_location === 'string') {
      this.state.location = data.current_location;

      if (Array.isArray(data.visible_characters)) {
        const visible = new Set(
          data.visible_characters
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.toLowerCase()),
        );

        for (const character of this.state.characters) {
          if (visible.has(character.first_name.toLowerCase())) {
            character.location_name = data.current_location;
          }
        }
      }
    }

    if (typeof data.current_talk_character === 'string' || data.current_talk_character === null) {
      this.state.current_talk_character = data.current_talk_character;
    }

    const outcome = data.result;
    const isAccuseEnded = endpoint === 'game-accuse' && data.mode === 'ended';
    if (isAccuseEnded && (outcome === 'win' || outcome === 'lose')) {
      this.accusationOutcome = outcome;
      this.awaitingReturnToList = true;
      return;
    }

    this.accusationOutcome = null;
    this.awaitingReturnToList = false;
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

            this.appendSystemFeedback(narration);
            this.applyBackendState(payload, invocation.endpoint);
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
