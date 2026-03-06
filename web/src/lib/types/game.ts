export interface GameState {
    locations: { name: string }[];
    characters: {
        first_name: string;
        last_name: string;
        location_name: string;
    }[];
    time_remaining: number;
    location: string;
    mode: "explore" | "talk" | "accuse" | "ended";
    current_talk_character: string | null;
    clues: string[]; // array of stable clue IDs
    narration: string;
    history: {
        sequence: number;
        event_type: string;
        actor: "player" | "system";
        narration: string;
    }[];
}

export interface Blueprint {
    id: string;
    title: string;
    one_liner: string;
    target_age: number;
}
