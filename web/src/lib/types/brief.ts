export interface BriefSummary {
  id: string;
  brief: string;
  title_hint: string | null;
  target_age: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface BriefFull extends BriefSummary {
  time_budget: number | null;
  one_liner_hint: string | null;
  art_style: string | null;
  must_include: string[];
  culprits: number | null;
  suspects: number | null;
  witnesses: number | null;
  locations: number | null;
  red_herring_trails: number | null;
  cover_ups: boolean | null;
  elimination_complexity: 'simple' | 'moderate' | 'complex' | null;
}
