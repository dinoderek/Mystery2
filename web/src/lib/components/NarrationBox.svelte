<script lang="ts">
  import { tick } from 'svelte';
  import { gameSessionStore } from '$lib/domain/store.svelte';
  import type { HistoryEntry } from '$lib/types/game';
  import TerminalMessage from './TerminalMessage.svelte';
  import TerminalSpinner from './TerminalSpinner.svelte';
  import SignedImage from './SignedImage.svelte';

  interface HistoryGroup {
    entries: HistoryEntry[];
    imageId: string | null;
    imageTitle: string;
  }

  let sentinel: HTMLDivElement;

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
          imageTitle: inferImageTitle(entry),
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
          imageTitle: '',
        };
        groups.push(current);
      }
    }

    return groups;
  });

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

  $effect(() => {
    const _len = renderedHistory.length;

    if (sentinel) {
      tick().then(() => {
        sentinel.scrollIntoView({ behavior: 'smooth', block: 'end' });
      });
    }
  });
</script>

<div class="flex min-h-0 flex-1">
  <div class="flex-1 overflow-y-auto border border-t-muted/30 p-4 font-mono">
    <div class="space-y-4">
      {#each groupedHistory as group}
        {#if group.imageId && gameSessionStore.blueprint_id}
          <div class="narration-image-group">
            <div class="narration-image-float">
              <div class="story-image-panel">
                <SignedImage
                  blueprintId={gameSessionStore.blueprint_id}
                  imageId={group.imageId}
                  alt={group.imageTitle}
                />
              </div>
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
