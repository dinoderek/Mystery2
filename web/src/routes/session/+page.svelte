<script lang="ts">
  import { onMount } from 'svelte';
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

  onMount(() => {
    if (gameSessionStore.status !== 'active' || !gameSessionStore.game_id) {
      goto('/');
    }
  });

  async function handleKeydown(event: KeyboardEvent) {
    // The notebook owns every key while it is open — its own window handler
    // drives Tab, Esc, the arrows and 1-4 — so nothing here may run underneath
    // it and page the transcript or start the case behind the overlay.
    if (gameSessionStore.showNotebook) {
      return;
    }

    // Alt+arrows page through history. Plain arrows are left alone so they can
    // still move the cursor inside the command input.
    if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      if (event.key === 'ArrowLeft') {
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
      await gameSessionStore.enterStartingLocation();
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
    try {
      await gameSessionStore.loadSessionCatalog(true);
    } finally {
      gameSessionStore.clearSessionForMysteryList();
      await goto('/');
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<main class="flex h-screen w-screen bg-t-bg font-mono text-t-primary">
  <section class="flex h-full min-w-0 basis-1/3 flex-col p-4">
    <Header />
    <PageNavigator />
    <PageNarration />
    <StatusBar />
    <InputBox />
  </section>

  <aside class="h-full basis-2/3">
    <ScenePane />
  </aside>

  <HelpModal />
  <NotebookPanel />
  <ClueDiscoveredToast />
</main>
