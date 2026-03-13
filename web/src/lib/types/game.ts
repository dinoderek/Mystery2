export type SpeakerKind = 'investigator' | 'narrator' | 'character' | 'system';

export interface Speaker {
  kind: SpeakerKind;
  key: string;
  label: string;
}

export interface HistoryEntry {
  sequence: number;
  event_type: string;
  narration: string;
  speaker: Speaker;
}

export interface GameState {
  locations: { name: string }[];
  characters: {
    first_name: string;
    last_name: string;
    location_name: string;
  }[];
  time_remaining: number;
  location: string;
  mode: 'explore' | 'talk' | 'accuse' | 'ended';
  current_talk_character: string | null;
  narration: string;
  narration_speaker: Speaker;
  history: HistoryEntry[];
  location_image_id?: string | null;
  character_portrait_image_id?: string | null;
}

export interface Blueprint {
  id: string;
  title: string;
  one_liner: string;
  target_age: number;
  blueprint_image_id?: string | null;
  blueprint_image_url?: string | null;
  blueprint_image_expires_at?: string | null;
  blueprint_image_placeholder?: boolean;
}

export interface StoryImageState {
  kind: 'location' | 'character';
  title: string;
  image_id: string;
  image_url: string | null;
  expires_at: string | null;
  placeholder: boolean;
  loading: boolean;
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
