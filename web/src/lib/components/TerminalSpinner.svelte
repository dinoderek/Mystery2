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

<div class="text-green-400/80 text-sm" data-testid="terminal-spinner">
  <span class="inline-block w-8">[{frames[frameIndex]}]</span>
  <span>{text}</span>
</div>
