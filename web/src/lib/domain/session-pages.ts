import type { NarrationEvent } from '$lib/types/game';

/**
 * The transcript is presented as a sequence of pages, one per interaction. A
 * page is a run of consecutive narration events sharing a scene: arriving
 * somewhere and searching it, or talking to someone and asking them things.
 *
 * Events are the unit of grouping rather than individual narration lines,
 * because the backend already emits one event per player action -- a single
 * event may carry several lines (the opening narration plus its notebook hint,
 * for instance) and those always belong to the same page.
 */

export type SessionPageKind = 'opening' | 'location' | 'conversation' | 'accusation';

export interface SessionPage {
  /** 0-based position in the page list. */
  index: number;
  kind: SessionPageKind;
  /**
   * Author-supplied page title. Always null today -- titles are a later change.
   * Render `title ?? fallbackLabel`.
   */
  title: string | null;
  /** Derived stand-in for the title: the location, the character, or the case. */
  fallbackLabel: string;
  /**
   * The scene image for this page. Falls back to the previous page's image when
   * the interaction has none of its own, so the scene pane never goes blank.
   */
  imageId: string | null;
  events: NarrationEvent[];
}

export interface SessionPageContext {
  /** Title of the mystery, used to label the opening page. */
  mysteryTitle?: string | null;
}

/**
 * Event types that begin a new interaction. Everything else -- `ask`, `search`,
 * the accusation rounds, and the client-side `input` / `system_response` /
 * `error` lines -- continues the page already open.
 *
 * `end_talk` opens a page because leaving a conversation puts the player back
 * in the location, which is a different scene with a different picture.
 */
export const PAGE_OPENING_EVENT_TYPES: ReadonlySet<string> = new Set([
  'start',
  'move',
  'talk',
  'end_talk',
  'accuse_start',
]);

const KIND_BY_EVENT_TYPE: Record<string, SessionPageKind> = {
  start: 'opening',
  move: 'location',
  end_talk: 'location',
  talk: 'conversation',
  accuse_start: 'accusation',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** First image carried by any narration line in the event, if any. */
function imageIdOf(event: NarrationEvent): string | null {
  for (const part of event.narration_parts) {
    if (part.image_id) {
      return part.image_id;
    }
  }
  return null;
}

function labelFor(
  event: NarrationEvent,
  kind: SessionPageKind,
  ctx: SessionPageContext,
): string {
  if (kind === 'opening') {
    return ctx.mysteryTitle?.trim() || 'The case';
  }
  if (kind === 'accusation') {
    return 'The accusation';
  }

  const payload = isRecord(event.payload) ? event.payload : {};
  const named = readString(payload.location_name) ?? readString(payload.character_name);
  if (named) {
    return named;
  }

  return kind === 'conversation' ? 'Conversation' : 'Location';
}

/**
 * Group narration events into pages. Events arrive in play order; the first one
 * is assumed to open a page even if its type is not a page-opening type, so a
 * malformed or partial history still renders rather than dropping lines.
 */
export function buildSessionPages(
  events: NarrationEvent[],
  ctx: SessionPageContext = {},
): SessionPage[] {
  const pages: SessionPage[] = [];

  for (const event of events) {
    const open = pages[pages.length - 1];

    if (open && !PAGE_OPENING_EVENT_TYPES.has(event.event_type)) {
      open.events.push(event);
      open.imageId ??= imageIdOf(event);
      continue;
    }

    // "go to the garden" is the opening line of the garden, not a loose end
    // left behind in the kitchen -- so the echo of the command that caused this
    // page moves onto it, and the player sees their own words above the reply.
    const carried: NarrationEvent[] = [];
    if (open && open.events[open.events.length - 1]?.event_type === 'input') {
      carried.push(open.events.pop()!);
    }

    const kind = KIND_BY_EVENT_TYPE[event.event_type] ?? 'location';
    pages.push({
      index: pages.length,
      kind,
      title: null,
      fallbackLabel: labelFor(event, kind, ctx),
      imageId: imageIdOf(event) ?? open?.imageId ?? null,
      events: [...carried, event],
    });
  }

  return pages;
}
