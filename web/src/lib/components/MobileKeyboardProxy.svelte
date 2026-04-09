<script lang="ts">
  import { onMount } from 'svelte';
  import { mobileKeyboard } from '$lib/domain/mobile-keyboard.svelte';

  let inputEl = $state<HTMLInputElement | null>(null);
  let isMobile = $state(false);

  onMount(() => {
    isMobile = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    if (!isMobile) return;

    // Refocus the proxy whenever the user taps on a non-interactive area,
    // so keystrokes keep routing through it and iOS keeps the software
    // keyboard raised. Skip real form controls so components like InputBox
    // retain focus when the user taps into them.
    const refocus = (e: PointerEvent) => {
      if (mobileKeyboard.inputMode === 'none') return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('input, textarea, [contenteditable="true"], button, a, select, label')) {
        return;
      }
      inputEl?.focus();
    };

    window.addEventListener('pointerdown', refocus);
    return () => window.removeEventListener('pointerdown', refocus);
  });

  // Keep the proxy value empty. Keydown events bubble to window and reach
  // the existing page handlers regardless of the typed value.
  function handleInput() {
    if (inputEl) inputEl.value = '';
  }
</script>

{#if isMobile && mobileKeyboard.inputMode !== 'none'}
  <input
    bind:this={inputEl}
    type="text"
    inputmode={mobileKeyboard.inputMode}
    enterkeyhint="go"
    autocapitalize="off"
    autocorrect="off"
    autocomplete="off"
    spellcheck="false"
    aria-hidden="true"
    tabindex="-1"
    oninput={handleInput}
    data-testid="mobile-keyboard-proxy"
    class="mobile-kbd-proxy"
  />
{/if}

<style>
  .mobile-kbd-proxy {
    position: fixed;
    bottom: 0;
    left: 0;
    width: 1px;
    height: 1px;
    opacity: 0;
    border: 0;
    padding: 0;
    margin: 0;
    font-size: 16px; /* prevent iOS auto-zoom on focus */
    color: transparent;
    background: transparent;
    caret-color: transparent;
  }
</style>
