<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import type { WebGPURenderer } from 'three/webgpu';
  import type { buildScene } from '$lib/domain/scene-world';
  import type { SceneRecipe } from '@my2/shared';

  let { children, recipe, animated = true }: { children: Snippet; recipe: SceneRecipe; animated?: boolean } = $props();
  let canvas: HTMLCanvasElement;
  let ready = $state(false);
  let failed = $state(false);
  let paused = $state(false);

  onMount(() => {
    let cancelled = false;
    let renderer: WebGPURenderer | undefined;
    let world: ReturnType<typeof buildScene> | undefined;
    let resize: ResizeObserver | undefined;
    let lastFrame = -Infinity;
    let frameInterval = 1000 / 30;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');

    function fail(error: unknown) {
      if (cancelled || failed) return;
      console.error('[scene] Rendering failed; showing the existing illustration', { location_id: recipe.location_id, error });
      failed = true;
      if (renderer?.initialized) void renderer.setAnimationLoop(null);
    }

    function draw(milliseconds: number) {
      if (!renderer || !world || failed || cancelled) return;
      // Allow clock jitter so the cap does not miss an extra display frame.
      if (milliseconds - lastFrame < frameInterval - 1) return;
      try {
        const started = performance.now();
        world.animate(motion.matches || !animated ? 0 : milliseconds / 1000);
        renderer.render(world.scene, world.camera);
        // Leave time for dialogue and input when a software renderer is slow.
        frameInterval = Math.max(1000 / 30, (performance.now() - started) * 3);
        lastFrame = performance.now();
        ready = true;
      } catch (error) {
        fail(error);
      }
    }

    function updateAnimation() {
      if (!renderer?.initialized || cancelled || failed) return;
      paused = document.hidden || motion.matches || !animated;
      renderer.setAnimationLoop(null);
      lastFrame = -Infinity;
      if (document.hidden) return;
      draw(0);
      if (!paused && !failed) renderer.setAnimationLoop(draw);
    }

    async function start() {
      try {
        const [three, { buildScene }] = await Promise.all([
          import('three/webgpu'), import('$lib/domain/scene-world'),
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
        world = buildScene(recipe);
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
          console.error('[scene] Cleanup failed', { location_id: recipe.location_id, error });
        });
      }
    };
  });
</script>

<div class="relative h-full w-full" data-testid="scene-renderer" data-kind={recipe.kind} data-location-id={recipe.location_id}
  data-state={failed ? 'fallback' : ready ? 'ready' : 'loading'} data-paused={paused}>
  {#if !ready || failed}
    {@render children()}
  {/if}
  <div class="pointer-events-none absolute inset-0 h-full w-full"
    class:invisible={!ready || failed} role="img"
    aria-label={recipe.label}>
    <canvas bind:this={canvas} class="h-full w-full" aria-hidden="true"></canvas>
  </div>
</div>
