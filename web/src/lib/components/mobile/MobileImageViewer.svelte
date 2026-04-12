<script lang="ts">
  import { onMount } from 'svelte';
  import SignedImage from '$lib/components/SignedImage.svelte';

  let {
    blueprintId,
    imageId,
    alt = '',
    onclose,
  } = $props<{
    blueprintId: string;
    imageId: string;
    alt?: string;
    onclose: () => void;
  }>();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onclose();
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onclose();
    }
  }

  onMount(() => {
    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-50 bg-t-bg flex items-center justify-center"
  onclick={handleBackdropClick}
>
  <button
    class="absolute top-4 right-4 w-11 h-11 flex items-center justify-center text-t-muted hover:text-t-bright text-2xl font-mono z-10"
    onclick={onclose}
    aria-label="Close image viewer"
  >
    &#x2715;
  </button>
  <SignedImage
    {blueprintId}
    {imageId}
    {alt}
    class="max-h-full max-w-full object-contain"
  />
</div>
