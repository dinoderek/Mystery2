<script lang="ts">
  import { gameSessionStore } from "$lib/domain/store.svelte";

  function close() {
    gameSessionStore.showHelp = false;
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      close();
    }
  }
</script>

{#if gameSessionStore.showHelp}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 bg-t-bg/80 flex items-center justify-center p-4 z-50"
    onclick={handleBackdropClick}
  >
    <div
      class="bg-t-bg border border-t-muted shadow-[0_0_15px_var(--t-glow)] p-6 max-w-lg w-full max-h-[85vh] flex flex-col font-mono"
    >
      <h2
        class="text-xl font-bold text-t-primary border-b border-t-muted/30 pb-2 mb-4 shrink-0"
      >
        COMMAND REFERENCE
      </h2>

      <div class="space-y-4 text-t-muted/90 text-sm overflow-y-auto pr-1">
        <section>
          <h3 class="text-t-primary font-bold mb-1">EXPLORE MODE</h3>
          <ul class="list-disc list-inside pl-4 space-y-1">
            <li>
              <span class="text-t-bright">go to / move to / travel to / head towards / go / move [location]</span>
              - Move to a location
            </li>
            <li>
              <span class="text-t-bright">talk to / speak to / speak with [character]</span>
              - Start a conversation
            </li>
            <li>
              <span class="text-t-bright">search / look around / inspect / look</span>
              - Search the current location
            </li>
            <li>
              <span class="text-t-bright">accuse [statement]</span>
              - Say who did it, and why you think so
            </li>
            <li>
              <span class="text-t-bright">locations / where can i go</span>
              - Open your notebook at Places: every place you can go, and who is there
            </li>
            <li>
              <span class="text-t-bright">characters / who is here</span>
              - Open your notebook at People: everyone you have met, and where they are
            </li>
          </ul>
        </section>

        <section>
          <h3 class="text-t-primary font-bold mb-1">TALK MODE</h3>
          <ul class="list-disc list-inside pl-4 space-y-1">
            <li>
              <span class="text-t-bright">[any question]</span> - Ask the current character
            </li>
            <li>
              <span class="text-t-bright">bye / leave / end / goodbye / see you</span>
              - End the conversation
            </li>
          </ul>
        </section>

        <section>
          <h3 class="text-t-primary font-bold mb-1">THEMES</h3>
          <ul class="list-disc list-inside pl-4 space-y-1">
            <li>
              <span class="text-t-bright">themes</span> - List available color themes
            </li>
            <li>
              <span class="text-t-bright">theme [name]</span> - Switch to a color theme
            </li>
          </ul>
        </section>

        <section>
          <h3 class="text-t-primary font-bold mb-1">GENERAL</h3>
          <ul class="list-disc list-inside pl-4 space-y-1">
            <li><span class="text-t-bright">Tab / notebook / n</span> - Open and close your case notebook: what you know, who you have met, and every clue you have found. Inside it, left/right arrows change section, up/down arrows scroll, 1-4 jump straight to a section</li>
            <li><span class="text-t-bright">zoom</span> - See the picture of this place in full screen</li>
            <li><span class="text-t-bright">help</span> - Open this list of commands</li>
            <li><span class="text-t-bright">quit / exit</span> - Stop playing this case</li>
          </ul>
        </section>
      </div>

      <button
        class="mt-6 w-full border border-t-muted/50 hover:bg-t-muted/10 text-t-primary py-2 transition-colors cursor-pointer shrink-0"
        onclick={close}
      >
        [ CLOSE ]
      </button>
    </div>
  </div>
{/if}
