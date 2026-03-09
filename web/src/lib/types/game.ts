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
}

export interface Blueprint {
  id: string;
  title: string;
  one_liner: string;
  target_age: number;
}
