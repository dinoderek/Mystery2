<script lang="ts">
  import { gameSessionStore } from '$lib/domain/store.svelte';
  import TerminalMessage from './TerminalMessage.svelte';

  function close() {
    gameSessionStore.showZoomModal = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      close();
    }
  }

  const sceneEntries = $derived(gameSessionStore.getActiveSceneText());
  const image = $derived(gameSessionStore.activeStoryImage);
</script>

<svelte:window onkeydown={handleKeydown} />

{#if gameSessionStore.showZoomModal && image?.image_url}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 bg-t-bg/95"
    onclick={close}
  >
    <div class="zoom-layout">
      {#if sceneEntries.length > 0}
        <div class="zoom-text-pane">
          <div class="space-y-2 font-mono">
            {#each sceneEntries as entry}
              <TerminalMessage text={entry.text} speaker={entry.speaker} theme={gameSessionStore.theme} />
            {/each}
          </div>
        </div>
      {/if}

      <div class="zoom-image-pane">
        <img
          src={image.image_url}
          alt={image.title}
          class="max-h-full max-w-full object-contain"
        />
      </div>
    </div>
  </div>
{/if}

<style>
  /* Default (portrait / narrow): stacked vertically, image on top, text below */
  .zoom-layout {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .zoom-image-pane {
    flex: 1 1 0%;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    order: 0;
  }

  .zoom-text-pane {
    flex-shrink: 0;
    max-height: 30vh;
    overflow-y: auto;
    padding: 1rem 1.5rem;
    order: 1;
    border-top: 1px solid color-mix(in srgb, var(--t-muted) 30%, transparent);
    background: color-mix(in srgb, var(--t-bg) 80%, transparent);
  }

  /* Wide viewport: side-by-side, text 1/3 on left, image 2/3 on right */
  @media (min-aspect-ratio: 4/3) and (min-width: 768px) {
    .zoom-layout {
      flex-direction: row;
    }

    .zoom-image-pane {
      flex: 0 0 66.667%;
      max-width: 66.667%;
      order: 1;
    }

    .zoom-text-pane {
      flex: 1 1 0%;
      max-height: none;
      overflow-y: auto;
      order: 0;
      border-top: none;
      border-right: 1px solid color-mix(in srgb, var(--t-muted) 30%, transparent);
      padding: 1.5rem;
    }
  }
</style>
