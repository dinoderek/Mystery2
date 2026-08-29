<script lang="ts">
  import { blueprintImageUrl } from '$lib/api/client';

  let {
    blueprintId,
    imageId,
    alt = '',
    class: className = '',
    loadingText = 'Loading image...',
    placeholderText = 'Image unavailable',
    onload = undefined,
    onfail = undefined,
  } = $props<{
    blueprintId: string;
    imageId: string;
    alt?: string;
    class?: string;
    loadingText?: string;
    placeholderText?: string;
    onload?: () => void;
    onfail?: () => void;
  }>();

  // Images are served from a stable same-origin path, so there is no link to
  // fetch first, nothing to expire, and no refresh sweep — what used to be a
  // subscription to a signed-URL cache is now an `src`. The only failure left
  // is the request itself, which the browser reports through `onerror`.
  let src = $derived(blueprintImageUrl(blueprintId, imageId));
  let loading = $state(true);
  let broken = $state(false);

  $effect(() => {
    // A new image means the previous load's outcome no longer applies.
    void src;
    loading = true;
    broken = false;
  });

  function handleLoad() {
    loading = false;
    onload?.();
  }

  function handleError() {
    loading = false;
    broken = true;
    onfail?.();
  }
</script>

{#if broken}
  <div class="story-image-placeholder flex items-center justify-center text-sm text-t-muted/80 {className}">
    {placeholderText}
  </div>
{:else}
  {#if loading}
    <div class="story-image-placeholder flex items-center justify-center text-sm text-t-muted/70 animate-pulse {className}">
      {loadingText}
    </div>
  {/if}
  <img
    {src}
    {alt}
    class="story-image-asset block {className}"
    class:hidden={loading}
    loading="lazy"
    onload={handleLoad}
    onerror={handleError}
  />
{/if}
