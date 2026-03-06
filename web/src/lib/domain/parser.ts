export type ActionCommand =
    | { type: 'move'; destination: string }
    | { type: 'search' }
    | { type: 'talk'; character_id: string }
    | { type: 'ask'; question: string }
    | { type: 'accuse'; character_id: string }
    | { type: 'end_talk' }
    | { type: 'help' }
    | { type: 'unknown'; raw: string };

export function parseCommand(input: string, mode: 'explore' | 'talk' | 'accuse' | 'ended'): ActionCommand {
    const text = input.trim().toLowerCase();

    if (text === '') return { type: 'unknown', raw: '' };
    if (text === 'help') return { type: 'help' };

    if (mode === 'talk') {
        if (text === 'bye' || text === 'leave' || text === 'end') {
            return { type: 'end_talk' };
        }
        return { type: 'ask', question: text };
    }

    if (mode === 'explore') {
        if (text === 'search' || text.startsWith('search ')) {
            return { type: 'search' };
        }
        if (text.startsWith('go to ') || text.startsWith('move to ')) {
            const dest = text.replace(/^(go to|move to)\s+/, '').trim();
            return { type: 'move', destination: dest };
        }
        if (text.startsWith('go ') || text.startsWith('move ')) {
            const dest = text.replace(/^(go|move)\s+/, '').trim();
            return { type: 'move', destination: dest };
        }
        if (text.startsWith('talk to ')) {
            const char = text.replace(/^talk to\s+/, '').trim();
            return { type: 'talk', character_id: char }; // Simple mapping, store needs to resolve string to ID if necessary
        }
        if (text.startsWith('accuse ')) {
            const char = text.replace(/^accuse\s+/, '').trim();
            return { type: 'accuse', character_id: char };
        }
    }

    return { type: 'unknown', raw: text };
}
