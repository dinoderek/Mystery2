<script lang="ts">
  import { blueprintImageUrl } from '$lib/api/client';

  let {
    blueprintId,
    imageId,
    alt = '',
    class: className = '',
    placeholderText = 'Image unavailable',
    onload = undefined,
    onfail = undefined,
  } = $props<{
    blueprintId: string;
    imageId: string;
    alt?: string;
    class?: string;
    placeholderText?: string;
    onload?: () => void;
    onfail?: () => void;
  }>();

  // Images are served from a stable same-origin path, so there is no link to
  // fetch first, nothing to expire, and no refresh sweep. What used to be a
  // subscription to a signed-URL cache is an `src`, and the only state left is
  // whether the browser managed to load it.
  let src = $derived(blueprintImageUrl(blueprintId, imageId));
  let brokenSrc = $state<string | null>(null);

  function handleError() {
    brokenSrc = src;
    onfail?.();
  }
</script>

{#if brokenSrc === src}
  <div class="story-image-placeholder flex items-center justify-center text-sm text-t-muted/80 {className}">
    {placeholderText}
  </div>
{:else}
  <img
    {src}
    {alt}
    class="story-image-asset block {className}"
    loading="lazy"
    onload={() => onload?.()}
    onerror={handleError}
  />
{/if}
