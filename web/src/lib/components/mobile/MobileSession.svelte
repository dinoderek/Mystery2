<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { gameSessionStore } from '$lib/domain/store.svelte';
  import { mobileKeyboard } from '$lib/domain/mobile-keyboard.svelte';
  import { mobilePrefs } from '$lib/domain/mobile-prefs.svelte';
  import { MobileSessionState } from '$lib/domain/mobile-session.svelte';
  import MobileTopBar from './MobileTopBar.svelte';
  import MobileInputBar from './MobileInputBar.svelte';
  import MobileActionBar from './MobileActionBar.svelte';
  import MobileDrawer from './MobileDrawer.svelte';
  import MobileImageViewer from './MobileImageViewer.svelte';
  import NarrationBox from '$lib/components/NarrationBox.svelte';
  import TerminalMessage from '$lib/components/TerminalMessage.svelte';
  import HelpModal from '$lib/components/HelpModal.svelte';
  import SceneZoomModal from '$lib/components/SceneZoomModal.svelte';

  const state = new MobileSessionState();

  const textSizeClass = $derived.by(() => {
    switch (mobilePrefs.textSize) {
      case 'sm':
        return 'text-sm';
      case 'lg':
        return 'text-lg';
      default:
        return 'text-base';
    }
  });

  onMount(() => {
    if (gameSessionStore.status !== 'active' || !gameSessionStore.game_id) {
      goto('/');
    }
    mobileKeyboard.inputMode = 'none';
    return () => {
      mobileKeyboard.inputMode = 'none';
    };
  });

  function handleBack() {
    goto('/');
  }

  function handleReply() {
    state.switchToInput();
  }

  function handleInputPrefill(text: string) {
    state.switchToInputWithPrefill(text);
  }

  function handleSend(text: string) {
    state.handleSend(text);
  }

  function handleCancelInput() {
    state.handleCancel();
  }

  function handleImageTap(imageId: string) {
    state.openImageViewer(imageId);
  }

  async function handleEndStateTap() {
    await state.handleEndStateTap();
    await goto('/');
  }
</script>

<main
  class="min-h-screen bg-t-bg text-t-primary font-mono flex flex-col h-screen"
  data-testid="mobile-session"
>
  {#if state.isEndState}
    <!-- End state: full-screen tap-to-return -->
    <MobileTopBar
      title={state.title}
      showMenu={false}
    />
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="flex-1 flex flex-col items-center justify-center px-6"
      onclick={handleEndStateTap}
      data-testid="mobile-session-end-state"
    >
      <div class="text-center space-y-4">
        <h1 class="text-2xl font-bold text-t-bright" data-testid="end-state-label">
          {state.endStateLabel}
        </h1>
        {#if state.accusationOutcome === 'win'}
          <p class="text-t-primary text-sm">Congratulations, detective.</p>
        {:else if state.accusationOutcome === 'lose'}
          <p class="text-t-muted text-sm">The truth remains hidden.</p>
        {/if}
        <p class="text-t-muted/60 text-xs mt-8 animate-pulse">TAP ANYWHERE TO RETURN</p>
      </div>
    </div>

  {:else if state.sessionMode === 'input'}
    <!-- Input mode -->
    <MobileTopBar
      title={state.title}
      turnsRemaining={state.turnsRemaining}
      onback={handleBack}
      onmenu={() => state.toggleDrawer()}
    />

    <div class="flex-1 overflow-y-auto p-4 {textSizeClass}">
      {#each state.lastInteractionGroup as entry}
        <TerminalMessage
          text={entry.text}
          speaker={entry.speaker}
          theme={gameSessionStore.theme}
        />
      {/each}
    </div>

    <MobileInputBar
      onsend={handleSend}
      oncancel={handleCancelInput}
      disabled={state.isLoading}
      placeholder={state.inputPlaceholder}
      prefill={state.effectivePrefill}
    />

  {:else}
    <!-- Reading mode -->
    <MobileTopBar
      title={state.title}
      turnsRemaining={state.turnsRemaining}
      onback={handleBack}
      onmenu={() => state.toggleDrawer()}
    />

    <div class="flex-1 min-h-0 {textSizeClass}">
      <NarrationBox onimagetap={handleImageTap} />
    </div>

    {#if !state.isReadOnly}
      <MobileActionBar
        onreply={handleReply}
        oninputprefill={handleInputPrefill}
      />

      <!-- Floating reply button -->
      {#if !state.isLoading}
        <button
          type="button"
          onclick={handleReply}
          aria-label="Reply"
          data-testid="mobile-session-reply-fab"
          class="fixed bottom-20 right-4 w-14 h-14 rounded-full bg-t-primary/20 border border-t-primary
            text-t-primary text-xl flex items-center justify-center z-30
            active:bg-t-primary/30"
        >
          &#x1F4AC;
        </button>
      {/if}
    {/if}
  {/if}

  <!-- Overlays (always rendered, visibility controlled internally) -->
  <MobileDrawer bind:open={state.drawerOpen} />

  {#if state.showImageViewer && state.activeViewerImageId && gameSessionStore.blueprint_id}
    <MobileImageViewer
      blueprintId={gameSessionStore.blueprint_id}
      imageId={state.activeViewerImageId}
      onclose={() => state.closeImageViewer()}
    />
  {/if}

  <HelpModal />
  <SceneZoomModal />
</main>
