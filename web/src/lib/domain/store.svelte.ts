import { supabase } from '../api/supabase';
import type { GameState, Blueprint } from '../types/game';
import { parseCommand } from './parser';

export class GameSessionStore {
    game_id = $state<string | null>(null);
    status = $state<'idle' | 'loading' | 'active' | 'error'>('idle');
    state = $state<GameState | null>(null);
    error = $state<string | null>(null);
    blueprints = $state<Blueprint[]>([]);
    showHelp = $state(false);

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
            body: { blueprint_id: blueprintId }
        });
        if (error) {
            this.error = error.message;
            this.status = 'error';
        } else {
            this.game_id = data.game_id;
            this.state = data.state;
            this.status = 'active';
        }
    }

    async submitInput(input: string) {
        if (!this.state || !this.game_id || this.status === 'loading') return;
        const command = parseCommand(input, this.state.mode);

        this.status = 'loading';
        this.error = null;

        if (!this.state.history) this.state.history = [];
        this.state.history.push({
            sequence: this.state.history.length + 1,
            event_type: 'input',
            actor: 'player',
            narration: input
        });

        let endpoint = '';
        let body: Record<string, unknown> = {};

        switch (command.type) {
            case 'move': endpoint = 'game-move'; body = { destination: command.destination }; break;
            case 'search': endpoint = 'game-search'; break;
            case 'talk': endpoint = 'game-talk'; body = { character_id: command.character_id }; break;
            case 'ask': endpoint = 'game-ask'; body = { question: command.question }; break;
            case 'end_talk': endpoint = 'game-end-talk'; break;
            case 'accuse': endpoint = 'game-accuse'; body = { accused_character_id: command.character_id }; break;
            case 'help':
                this.showHelp = true;
                this.state.history.push({ sequence: this.state.history.length + 1, event_type: 'system_response', actor: 'system', narration: 'Help menu opened.' });
                this.status = 'active';
                return;
            default:
                this.state.history.push({
                    sequence: this.state.history.length + 1,
                    event_type: 'error',
                    actor: 'system',
                    narration: `Unknown command: ${input}`
                });
                this.status = 'active';
                return;
        }

        try {
            const { data, error } = await supabase.functions.invoke(`${endpoint}/${this.game_id}`, { body });
            if (error) {
                this.error = error.message;
                this.state.history.push({ sequence: this.state.history.length + 1, event_type: 'error', actor: 'system', narration: `Error: ${error.message}` });
            } else if (data) {
                this.state.history.push({
                    sequence: this.state.history.length + 1,
                    event_type: 'system_response',
                    actor: 'system',
                    narration: data.narration || data.response || 'Action completed.'
                });
                if (data.mode) this.state.mode = data.mode;
                if (data.time_remaining !== undefined) this.state.time_remaining = data.time_remaining;
            }
        } catch (e) {
            this.error = e instanceof Error ? e.message : String(e);
        } finally {
            this.status = 'active';
        }
    }
}

export const gameSessionStore = new GameSessionStore();
