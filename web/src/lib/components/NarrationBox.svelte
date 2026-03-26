<script lang="ts">
  import { tick } from 'svelte';
  import { gameSessionStore } from '$lib/domain/store.svelte';
  import { resolveImageLink } from '$lib/api/images';
  import { isImageLinkExpired } from '$lib/domain/store.retry';
  import type { HistoryEntry } from '$lib/types/game';
  import TerminalMessage from './TerminalMessage.svelte';
  import TerminalSpinner from './TerminalSpinner.svelte';

  interface HistoryGroup {
    entries: HistoryEntry[];
    imageId: string | null;
    imageUrl: string | null;
    imageTitle: string;
    imageLoading: boolean;
  }

  let sentinel: HTMLDivElement;
  let scrollContainer: HTMLDivElement;

  function isNearBottom(): boolean {
    if (!scrollContainer) return true;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    return scrollHeight - scrollTop - clientHeight < 80;
  }

  function scrollToBottomIfNeeded() {
    if (isNearBottom() && sentinel) {
      sentinel.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }

  const renderedHistory = $derived.by(() => {
    const state = gameSessionStore.state;
    if (!state) {
      return [];
    }
    return state.history;
  });

  /**
   * Group consecutive history entries by sequence.
   * An entry with an image_id anchors the group; subsequent entries
   * sharing the same sequence inherit that image.
   */
  const groupedHistory = $derived.by((): HistoryGroup[] => {
    const history = renderedHistory;
    if (history.length === 0) return [];

    const groups: HistoryGroup[] = [];
    let current: HistoryGroup | null = null;

    for (const entry of history) {
      const hasNewImage = Boolean(entry.image_id);

      if (hasNewImage) {
        // Start a new image group
        current = {
          entries: [entry],
          imageId: entry.image_id!,
          imageUrl: null,
          imageTitle: '',
          imageLoading: true,
        };
        groups.push(current);
      } else if (current && current.imageId && entry.sequence === current.entries[0].sequence) {
        // Same sequence as the image-bearing entry — continue the group
        current.entries.push(entry);
      } else {
        // No image, different sequence — standalone group
        current = {
          entries: [entry],
          imageId: null,
          imageUrl: null,
          imageTitle: '',
          imageLoading: false,
        };
        groups.push(current);
      }
    }

    return groups;
  });

  // Resolved image URLs keyed by image_id
  let resolvedImages = $state<Map<string, { url: string | null; expiresAt: string | null; title: string; loading: boolean }>>(new Map());

  function inferImageTitle(entry: HistoryEntry): string {
    if (entry.event_type === 'start') {
      const blueprint = gameSessionStore.blueprints.find((b) => b.id === gameSessionStore.blueprint_id);
      return blueprint ? blueprint.title : 'Mystery cover';
    }
    if (entry.event_type === 'talk' || entry.event_type === 'ask') {
      const label = entry.speaker.label || gameSessionStore.state?.current_talk_character || 'Character';
      return `${label}`;
    }
    return gameSessionStore.state?.location || 'Location';
  }

  // Resolve images for groups that need them, and re-resolve when expired
  $effect(() => {
    const groups = groupedHistory;
    for (const group of groups) {
      if (!group.imageId) continue;

      const existing = resolvedImages.get(group.imageId);
      if (existing && (existing.loading || !isImageLinkExpired(existing.expiresAt))) continue;

      const imageId = group.imageId;
      const anchorEntry = group.entries[0];
      const blueprintId = gameSessionStore.blueprint_id;

      if (!blueprintId) continue;

      // Mark as loading
      resolvedImages.set(imageId, { url: existing?.url ?? null, expiresAt: null, title: inferImageTitle(anchorEntry), loading: true });
      resolvedImages = new Map(resolvedImages);

      resolveImageLink({
        blueprintId,
        imageId,
      }).then((resolved) => {
        resolvedImages.set(imageId, {
          url: resolved.placeholder ? null : resolved.url,
          expiresAt: resolved.expiresAt,
          title: inferImageTitle(anchorEntry),
          loading: false,
        });
        resolvedImages = new Map(resolvedImages);
      });
    }
  });

  // Enrich groups with resolved image data
  const enrichedGroups = $derived.by((): HistoryGroup[] => {
    return groupedHistory.map((group) => {
      if (!group.imageId) return group;
      const resolved = resolvedImages.get(group.imageId);
      if (!resolved) return group;
      return {
        ...group,
        imageUrl: resolved.url,
        imageTitle: resolved.title,
        imageLoading: resolved.loading,
      };
    });
  });

  $effect(() => {
    const _len = renderedHistory.length;

    if (sentinel) {
      tick().then(() => {
        scrollToBottomIfNeeded();
      });
    }
  });
</script>

<div class="flex min-h-0 flex-1">
  <div bind:this={scrollContainer} class="flex-1 overflow-y-auto border border-t-muted/30 p-4 font-mono">
    <div class="space-y-4">
      {#each enrichedGroups as group}
        {#if group.imageId && (group.imageUrl || group.imageLoading)}
          <div class="narration-image-group">
            <div class="narration-image-float">
              {#if group.imageLoading}
                <div class="story-image-placeholder flex items-center justify-center text-sm text-t-muted/70 animate-pulse my-4">
                  Loading image...
                </div>
              {:else if group.imageUrl}
                <div class="story-image-panel">
                  <img
                    src={group.imageUrl}
                    alt={group.imageTitle}
                    class="story-image-asset block w-full object-cover"
                    loading="lazy"
                    onload={scrollToBottomIfNeeded}
                  />
                </div>
              {/if}
            </div>
            {#each group.entries as event}
              <TerminalMessage text={event.text} speaker={event.speaker} theme={gameSessionStore.theme} />
            {/each}
            <div class="narration-image-clear"></div>
          </div>
        {:else}
          {#each group.entries as event}
            <TerminalMessage text={event.text} speaker={event.speaker} theme={gameSessionStore.theme} />
          {/each}
        {/if}
      {/each}

      {#if gameSessionStore.status === 'loading' && gameSessionStore.state}
        <TerminalSpinner text="Narrator is thinking..." />
      {/if}
    </div>
    <div bind:this={sentinel} aria-hidden="true"></div>
  </div>
</div>
