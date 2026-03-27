<script lang="ts">
  import { onMount } from "svelte";

  let { text = "Loading..." } = $props<{ text?: string }>();

  const frames = ["|", "/", "-", "\\"];
  let frameIndex = $state(0);

  onMount(() => {
    const intervalId = setInterval(() => {
      frameIndex = (frameIndex + 1) % frames.length;
    }, 120);

    return () => {
      clearInterval(intervalId);
    };
  });
</script>

<div class="text-t-primary/80 text-sm text-center my-4 animate-pulse" data-testid="terminal-spinner">
  <span class="inline-block w-8">[{frames[frameIndex]}]</span>
  <span>{text}</span>
</div>
