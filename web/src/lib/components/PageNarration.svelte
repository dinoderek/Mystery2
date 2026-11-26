<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { isNearEnd } from '$lib/domain/viewport';
  import { gameSessionStore } from '$lib/domain/store.svelte';
  import TerminalMessage from './TerminalMessage.svelte';
  import TerminalSpinner from './TerminalSpinner.svelte';

  let scrollContainer = $state<HTMLDivElement | null>(null);

  // Whether the reader means to be at the end, so a resize can keep them there.
  // It follows intent, not position: a smooth scroll toward the end only ever
  // raises `scrollTop`, so it never clears this, while the reader scrolling up
  // lowers it, and does.
  let atEnd = true;
  let lastTop = 0;

  const page = $derived(gameSessionStore.activePage);

  const lines = $derived.by(() =>
    (page?.events ?? []).flatMap((event) => event.narration_parts),
  );

  /**
   * A live page grows at the bottom as the story advances, so follow it there.
   * Turning back to an older page should instead start at its beginning.
   */
  $effect(() => {
    const container = scrollContainer;
    const atBottom = gameSessionStore.isOnLivePage;
    // Re-run whenever either the page or its length changes.
    const _index = page?.index;
    const _count = lines.length;

    if (!container) return;
    atEnd = atBottom;
    tick().then(() => {
      container.scrollTo({
        top: atBottom ? container.scrollHeight : 0,
        behavior: 'smooth',
      });
    });
  });

  // The on-screen keyboard shrinks this area; a live page keeps its last line in view.
  onMount(() => {
    if (!scrollContainer) return;
    const resize = new ResizeObserver(() => {
      if (scrollContainer && atEnd && gameSessionStore.isOnLivePage) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    });
    resize.observe(scrollContainer);
    return () => resize.disconnect();
  });
</script>

<div
  bind:this={scrollContainer}
  onscroll={() => {
    if (!scrollContainer) return;
    const top = scrollContainer.scrollTop;
    if (isNearEnd(scrollContainer)) atEnd = true;
    else if (top < lastTop) atEnd = false;
    lastTop = top;
  }}
  class="min-h-0 flex-1 overflow-y-auto px-1 py-2 font-mono sm:border sm:border-t-muted/30 sm:p-4"
  data-testid="page-narration"
>
  <div class="space-y-4">
    {#each lines as line}
      <TerminalMessage text={line.text} speaker={line.speaker} />
    {/each}

    {#if gameSessionStore.status === 'loading' && gameSessionStore.isOnLivePage}
      <TerminalSpinner text="Narrator is thinking..." />
    {/if}
  </div>
</div>
