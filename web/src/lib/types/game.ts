export type SpeakerKind = 'investigator' | 'narrator' | 'character' | 'system';

export interface Speaker {
  kind: SpeakerKind;
  key: string;
  label: string;
}

export interface NarrationPart {
  text: string;
  speaker: Speaker;
  image_id?: string | null;
}

export interface NarrationEvent {
  sequence: number;
  event_type: string;
  narration_parts: NarrationPart[];
  payload?: Record<string, unknown> | null;
  created_at?: string;
}

export interface HistoryEntry {
  sequence: number;
  event_type: string;
  text: string;
  speaker: Speaker;
  image_id?: string | null;
}

export type DiscoveryThread =
  | { kind: 'solution'; label: string }
  | { kind: 'red_herring'; label: string }
  | { kind: 'eliminate'; label: string };

export type DiscoveryOrigin =
  | { kind: 'location'; location_id: string; location_name: string }
  | { kind: 'character'; character_id: string; character_name: string };

export interface DiscoveredClue {
  id: string;
  text: string;
  source: 'search' | 'talk';
  origin: DiscoveryOrigin;
  discovered_at: string | null;
  off_script: boolean;
  threads: DiscoveryThread[];
}

export interface GameState {
  locations: { id: string; name: string }[];
  characters: {
    id: string;
    first_name: string;
    last_name: string;
    location_name: string;
    sex: 'male' | 'female' | null;
  }[];
  time_remaining: number;
  location: string;
  mode: 'explore' | 'talk' | 'accuse' | 'ended';
  current_talk_character: string | null;
  history: HistoryEntry[];
  discovered_clues: DiscoveredClue[];
}

export interface Blueprint {
  id: string;
  title: string;
  one_liner: string;
  target_age: number;
  blueprint_image_id?: string | null;
}

export interface StoryImageState {
  kind: 'blueprint' | 'location' | 'character';
  title: string;
  image_id: string;
}

export type SessionMode = 'explore' | 'talk' | 'accuse' | 'ended';
export type SessionOutcome = 'win' | 'lose' | null;

export interface SessionSummary {
  game_id: string;
  blueprint_id: string;
  mystery_title: string;
  mystery_available: boolean;
  can_open: boolean;
  mode: SessionMode;
  time_remaining: number;
  outcome: SessionOutcome;
  last_played_at: string;
  created_at: string;
}

export interface SessionCatalog {
  in_progress: SessionSummary[];
  completed: SessionSummary[];
  counts: {
    in_progress: number;
    completed: number;
  };
}
