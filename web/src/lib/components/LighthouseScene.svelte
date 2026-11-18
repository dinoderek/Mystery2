<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import type { WebGPURenderer } from 'three/webgpu';
  import type { buildLighthouseScene } from '$lib/domain/lighthouse-scene';

  let { children }: { children: Snippet } = $props();
  let canvas: HTMLCanvasElement;
  let ready = $state(false);
  let failed = $state(false);
  let paused = $state(false);

  onMount(() => {
    let cancelled = false;
    let renderer: WebGPURenderer | undefined;
    let world: ReturnType<typeof buildLighthouseScene> | undefined;
    let resize: ResizeObserver | undefined;
    let lastFrame = -Infinity;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');

    function fail(error: unknown) {
      if (cancelled || failed) return;
      console.error('[scene] Lighthouse rendering failed; showing the existing illustration', error);
      failed = true;
      if (renderer?.initialized) void renderer.setAnimationLoop(null);
    }

    function draw(milliseconds: number) {
      if (!renderer || !world || failed || cancelled) return;
      // Allow clock jitter so the cap does not miss an extra display frame.
      if (milliseconds - lastFrame < 1000 / 30 - 1) return;
      lastFrame = milliseconds;
      try {
        world.animate(motion.matches ? 0 : milliseconds / 1000);
        renderer.render(world.scene, world.camera);
        ready = true;
      } catch (error) {
        fail(error);
      }
    }

    function updateAnimation() {
      if (!renderer?.initialized || cancelled || failed) return;
      paused = document.hidden || motion.matches;
      renderer.setAnimationLoop(null);
      lastFrame = -Infinity;
      if (document.hidden) return;
      draw(0);
      if (!motion.matches && !failed) renderer.setAnimationLoop(draw);
    }

    async function start() {
      try {
        const [three, { buildLighthouseScene }] = await Promise.all([
          import('three/webgpu'), import('$lib/domain/lighthouse-scene'),
        ]);
        if (cancelled) return;
        renderer = new three.WebGPURenderer({ canvas, antialias: true, alpha: false });
        renderer.onDeviceLost = fail;
        renderer.onError = fail;
        await renderer.init();
        if (cancelled || failed) {
          await renderer.dispose();
          return;
        }
        renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
        renderer.toneMapping = three.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.1;
        renderer.shadowMap.enabled = true;
        world = buildLighthouseScene();
        resize = new ResizeObserver(([entry]) => {
          if (!renderer || !world || cancelled || failed) return;
          const { width, height } = entry.contentRect;
          if (width < 1 || height < 1) return;
          try {
            renderer.setSize(width, height, false);
            world.camera.aspect = width / height;
            world.camera.updateProjectionMatrix();
            lastFrame = -Infinity;
            draw(0);
          } catch (error) {
            fail(error);
          }
        });
        resize.observe(canvas);
        updateAnimation();
      } catch (error) {
        fail(error);
      }
    }

    document.addEventListener('visibilitychange', updateAnimation);
    motion.addEventListener('change', updateAnimation);
    void start();
    return () => {
      cancelled = true;
      resize?.disconnect();
      document.removeEventListener('visibilitychange', updateAnimation);
      motion.removeEventListener('change', updateAnimation);
      if (renderer?.initialized) {
        renderer.setAnimationLoop(null);
        world?.dispose();
        void renderer.dispose().catch((error) => {
          console.error('[scene] Lighthouse cleanup failed', error);
        });
      }
    };
  });
</script>

<div class="relative h-full w-full" data-testid="lighthouse-scene"
  data-state={failed ? 'fallback' : ready ? 'ready' : 'loading'} data-paused={paused}>
  {#if !ready || failed}
    {@render children()}
  {/if}
  <div class="pointer-events-none absolute inset-0 h-full w-full"
    class:invisible={!ready || failed} role="img"
    aria-label="The lighthouse lantern room: an empty brass cradle, tall windows, and a grey-green sea.">
    <canvas bind:this={canvas} class="h-full w-full" aria-hidden="true"></canvas>
  </div>
</div>
