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
    class="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50"
    onclick={handleBackdropClick}
  >
    <div
      class="bg-black border border-green-500 shadow-[0_0_15px_rgba(34,197,94,0.3)] p-6 max-w-lg w-full font-mono"
    >
      <h2
        class="text-xl font-bold text-green-400 border-b border-green-500/30 pb-2 mb-4"
      >
        COMMAND REFERENCE
      </h2>

      <div class="space-y-4 text-green-500/90 text-sm">
        <section>
          <h3 class="text-green-400 font-bold mb-1">EXPLORE MODE</h3>
          <ul class="list-disc list-inside pl-4 space-y-1">
            <li>
              <span class="text-green-300">go to / move to / travel to / head towards / go / move [location]</span>
              - Move to a location
            </li>
            <li>
              <span class="text-green-300">talk to / speak to / speak with [character]</span>
              - Start a conversation
            </li>
            <li>
              <span class="text-green-300">search / look around / inspect / look</span>
              - Search the current location
            </li>
            <li>
              <span class="text-green-300">accuse [character]</span>
              - Make your final accusation
            </li>
            <li>
              <span class="text-green-300">locations / where can i go</span>
              - Show all locations and who is there
            </li>
            <li>
              <span class="text-green-300">characters / who is here</span>
              - Show characters in the current location
            </li>
          </ul>
        </section>

        <section>
          <h3 class="text-green-400 font-bold mb-1">TALK MODE</h3>
          <ul class="list-disc list-inside pl-4 space-y-1">
            <li>
              <span class="text-green-300">[any question]</span> - Ask the current character
            </li>
            <li>
              <span class="text-green-300">bye / leave / end / goodbye / see you</span>
              - End the conversation
            </li>
          </ul>
        </section>

        <section>
          <h3 class="text-green-400 font-bold mb-1">GENERAL</h3>
          <ul class="list-disc list-inside pl-4 space-y-1">
            <li><span class="text-green-300">help</span> - Open this detailed command reference</li>
            <li><span class="text-green-300">quit / exit</span> - End the current session</li>
          </ul>
        </section>
      </div>

      <button
        class="mt-6 w-full border border-green-500/50 hover:bg-green-500/10 text-green-400 py-2 transition-colors cursor-pointer"
        onclick={close}
      >
        [ CLOSE ]
      </button>
    </div>
  </div>
{/if}
