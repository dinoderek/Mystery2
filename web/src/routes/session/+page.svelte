<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { gameSessionStore } from '$lib/domain/store.svelte';
  import Header from '$lib/components/Header.svelte';
  import StatusBar from '$lib/components/StatusBar.svelte';
  import NarrationBox from '$lib/components/NarrationBox.svelte';
  import InputBox from '$lib/components/InputBox.svelte';
  import HelpModal from '$lib/components/HelpModal.svelte';
  import SceneZoomModal from '$lib/components/SceneZoomModal.svelte';
  import { mobileKeyboard } from '$lib/domain/mobile-keyboard.svelte';

  onMount(() => {
    if (gameSessionStore.status !== 'active' || !gameSessionStore.game_id) {
      goto('/');
    }
    mobileKeyboard.inputMode = 'text';
    return () => {
      mobileKeyboard.inputMode = 'none';
    };
  });

  async function handleKeydown(event: KeyboardEvent) {
    if (!gameSessionStore.awaitingReturnToList && gameSessionStore.viewerMode !== 'read_only_completed') {
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

<main class="min-h-screen bg-t-bg text-t-primary font-mono p-4 flex flex-col h-screen max-w-6xl mx-auto">
  <Header />
  <NarrationBox />
  <StatusBar />
  <InputBox />
  <HelpModal />
  <SceneZoomModal />
</main>
