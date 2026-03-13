<script lang="ts">
  import { tick } from 'svelte';
  import { gameSessionStore } from '$lib/domain/store.svelte';
  import { NARRATOR_SPEAKER } from '$lib/domain/speaker';
  import TerminalMessage from './TerminalMessage.svelte';
  import TerminalSpinner from './TerminalSpinner.svelte';
  import StoryImagePanel from './StoryImagePanel.svelte';

  let sentinel: HTMLDivElement;

  const renderedHistory = $derived.by(() => {
    const state = gameSessionStore.state;
    if (!state) {
      return [];
    }

    if (state.history.length > 0) {
      return state.history;
    }

    if (!state.narration) {
      return [];
    }

    return [
      {
        sequence: 1,
        event_type: 'narration',
        narration: state.narration,
        speaker: state.narration_speaker ?? NARRATOR_SPEAKER,
      },
    ];
  });

  $effect(() => {
    const _len = renderedHistory.length;

    if (sentinel) {
      tick().then(() => {
        sentinel.scrollIntoView({ behavior: 'smooth', block: 'end' });
      });
    }
  });
</script>

<div class="flex min-h-0 flex-1 gap-4">
  <div class="flex-1 overflow-y-auto border border-t-muted/30 p-4 font-mono">
    <div class="space-y-4">
      {#each renderedHistory as event}
        <TerminalMessage text={event.narration} speaker={event.speaker} theme={gameSessionStore.theme} />
      {/each}

      {#if gameSessionStore.status === 'loading' && gameSessionStore.state}
        <TerminalSpinner text="Narrator is thinking..." />
      {/if}
    </div>
    <div bind:this={sentinel} aria-hidden="true"></div>
  </div>

  {#if gameSessionStore.activeStoryImage}
    <aside class="hidden w-64 shrink-0 md:block">
      <StoryImagePanel
        title={gameSessionStore.activeStoryImage.title}
        imageUrl={gameSessionStore.activeStoryImage.image_url}
        placeholder={gameSessionStore.activeStoryImage.placeholder}
        loading={gameSessionStore.activeStoryImage.loading}
        placeholderText="Scene image unavailable"
      />
    </aside>
  {/if}
</div>
