<script lang="ts">
  import { onMount } from 'svelte';
  import { artPaneHeight, followVisualViewport, isCompact, type ViewportBox } from '$lib/domain/viewport';
  import { goto } from '$app/navigation';
  import { gameSessionStore } from '$lib/domain/store.svelte';
  import Header from '$lib/components/Header.svelte';
  import StatusBar from '$lib/components/StatusBar.svelte';
  import PageNavigator from '$lib/components/PageNavigator.svelte';
  import PageNarration from '$lib/components/PageNarration.svelte';
  import ScenePane from '$lib/components/ScenePane.svelte';
  import InputBox from '$lib/components/InputBox.svelte';
  import HelpModal from '$lib/components/HelpModal.svelte';
  import NotebookPanel from '$lib/components/NotebookPanel.svelte';
  import ClueDiscoveredToast from '$lib/components/ClueDiscoveredToast.svelte';
  import { beginInvestigation, returnToMysteryList } from '$lib/domain/session-prompts';

  // The visible part of the screen. It shrinks under the on-screen keyboard, so
  // the screen is sized to it rather than to the layout viewport; until it is
  // measured `dvh` stands in.
  let visible = $state<ViewportBox | null>(null);
  const compact = $derived(visible !== null && isCompact(visible.height));

  onMount(() => {
    if (gameSessionStore.status !== 'active' || !gameSessionStore.game_id) {
      goto('/');
    }
    return followVisualViewport(window, (box) => (visible = box));
  });

  async function handleKeydown(event: KeyboardEvent) {
    // The notebook owns every key while it is open — its own window handler
    // drives Tab, Esc, the arrows and 1-4 — so nothing here may run underneath
    // it and page the transcript or start the case behind the overlay.
    if (gameSessionStore.showNotebook) {
      return;
    }

    // Page through the transcript. Plain arrows are left alone so they can still
    // move the caret in the command input; PageUp/PageDown are the ergonomic
    // pair, since Alt+arrow is a word-jump in a macOS text field.
    const back =
      event.key === 'PageUp' || (event.altKey && event.key === 'ArrowLeft');
    const forward =
      event.key === 'PageDown' || (event.altKey && event.key === 'ArrowRight');
    if (back || forward) {
      event.preventDefault();
      if (back) {
        gameSessionStore.prevPage();
      } else {
        gameSessionStore.nextPage();
      }
      return;
    }

    if (gameSessionStore.awaitingOpeningConfirmation) {
      // Same carve-out as the end-state prompt below: Tab belongs to the
      // notebook, so it must not double as "begin the investigation".
      if (gameSessionStore.status === 'loading' || event.key === 'Tab') return;
      event.preventDefault();
      await beginInvestigation(gameSessionStore);
      return;
    }

    if (!gameSessionStore.awaitingReturnToList && gameSessionStore.viewerMode !== 'read_only_completed') {
      return;
    }

    // The one deliberate carve-out from "press any key": Tab still reaches
    // NotebookPanel so a finished case can be reviewed.
    if (event.key === 'Tab') {
      return;
    }

    event.preventDefault();
    await returnToMysteryList(gameSessionStore, goto);
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<main
  class="group fixed inset-x-0 top-0 flex h-dvh flex-col overflow-hidden bg-t-bg font-mono text-t-primary lg:flex-row"
  data-compact={compact}
  style:top={visible ? `${visible.top}px` : undefined}
  style:height={visible ? `${visible.height}px` : undefined}
  style:--art-height={visible ? `${artPaneHeight(visible.height)}px` : '32dvh'}
>
  <section class="order-2 flex min-h-0 min-w-0 flex-1 flex-col p-4 group-data-[compact=true]:p-2 lg:order-1 lg:h-full lg:basis-1/3">
    <Header />
    <PageNavigator />
    <PageNarration />
    <StatusBar />
    <InputBox />
  </section>

  <aside class="order-1 h-[var(--art-height)] shrink-0 overflow-hidden lg:order-2 lg:h-full lg:basis-2/3">
    <ScenePane />
  </aside>

  <HelpModal />
  <NotebookPanel />
  <ClueDiscoveredToast />
</main>
