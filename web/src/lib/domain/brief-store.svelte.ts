import { supabase } from '../api/supabase';
import type { BriefFull, BriefSummary } from '../types/brief';

export type BriefStatus = 'idle' | 'loading' | 'saving' | 'error';

/**
 * Converts a BriefFull (snake_case DB row) to a StoryBrief-shaped JSON
 * (camelCase) suitable for the generation pipeline.
 */
function toStoryBriefJson(brief: BriefFull): Record<string, unknown> {
  const out: Record<string, unknown> = {
    brief: brief.brief,
    targetAge: brief.target_age,
  };
  if (brief.time_budget != null) out.timeBudget = brief.time_budget;
  if (brief.title_hint != null) out.titleHint = brief.title_hint;
  if (brief.one_liner_hint != null) out.oneLinerHint = brief.one_liner_hint;
  if (brief.art_style != null) out.artStyle = brief.art_style;
  if (brief.must_include.length > 0) out.mustInclude = brief.must_include;
  if (brief.culprits != null) out.culprits = brief.culprits;
  if (brief.suspects != null) out.suspects = brief.suspects;
  if (brief.witnesses != null) out.witnesses = brief.witnesses;
  if (brief.locations != null) out.locations = brief.locations;
  if (brief.red_herring_trails != null) out.redHerringTrails = brief.red_herring_trails;
  if (brief.cover_ups != null) out.coverUps = brief.cover_ups;
  if (brief.elimination_complexity != null) out.eliminationComplexity = brief.elimination_complexity;
  return out;
}

export class BriefStore {
  briefs = $state<BriefSummary[]>([]);
  activeBrief = $state<BriefFull | null>(null);
  status = $state<BriefStatus>('idle');
  error = $state<string | null>(null);

  /** Pending duplicate data to pre-populate the new-brief form. */
  pendingDuplicate = $state<BriefFull | null>(null);

  async loadBriefs(): Promise<void> {
    this.status = 'loading';
    this.error = null;

    const { data, error } = await supabase.functions.invoke('briefs-list', {
      body: {},
    });

    if (error || !data?.briefs) {
      this.status = 'error';
      this.error = 'Failed to load briefs';
      return;
    }

    this.briefs = data.briefs as BriefSummary[];
    this.status = 'idle';
  }

  async loadBrief(id: string): Promise<void> {
    this.status = 'loading';
    this.error = null;

    const { data, error } = await supabase.functions.invoke('briefs-get', {
      body: { brief_id: id },
    });

    if (error || !data?.brief) {
      this.status = 'error';
      this.error = 'Failed to load brief';
      return;
    }

    this.activeBrief = data.brief as BriefFull;
    this.status = 'idle';
  }

  async saveBrief(payload: Record<string, unknown>): Promise<BriefFull | null> {
    this.status = 'saving';
    this.error = null;

    const { data, error } = await supabase.functions.invoke('briefs-save', {
      body: payload,
    });

    if (error || !data?.brief) {
      this.status = 'error';
      this.error = typeof data?.error === 'string' ? data.error : 'Failed to save brief';
      return null;
    }

    const saved = data.brief as BriefFull;
    this.activeBrief = saved;
    this.status = 'idle';
    return saved;
  }

  async archiveBrief(id: string): Promise<boolean> {
    this.error = null;

    const { data, error } = await supabase.functions.invoke('briefs-archive', {
      body: { brief_id: id },
    });

    if (error || !data?.brief) {
      this.error = 'Failed to archive brief';
      return false;
    }

    // Optimistic removal from list
    this.briefs = this.briefs.filter((b) => b.id !== id);
    return true;
  }

  prepareDuplicate(brief: BriefFull): void {
    this.pendingDuplicate = { ...brief };
  }

  consumeDuplicate(): BriefFull | null {
    const dup = this.pendingDuplicate;
    this.pendingDuplicate = null;
    return dup;
  }

  exportAsJson(brief: BriefFull): string {
    return JSON.stringify(toStoryBriefJson(brief), null, 2);
  }

  downloadAsJson(brief: BriefFull): void {
    const json = this.exportAsJson(brief);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const filename = brief.title_hint
      ? brief.title_hint.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')
      : 'brief';
    a.download = `${filename}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  clearActive(): void {
    this.activeBrief = null;
    this.error = null;
  }
}

export const briefStore = new BriefStore();
