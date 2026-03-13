<script lang="ts">
  import type { Speaker } from '$lib/types/game';
  import {
    getSpeakerThemeClasses,
    readTerminalTheme,
    type TerminalThemeName,
  } from './terminal-message-theme';

  let {
    text,
    speaker,
    theme = 'matrix',
  } = $props<{ text: string; speaker: Speaker; theme?: TerminalThemeName }>();

  const activeTheme = $derived(readTerminalTheme(theme));
  const speakerTheme = $derived(getSpeakerThemeClasses(activeTheme, speaker.kind));
</script>

<div
  class={`terminal-message mb-2 leading-relaxed ${speakerTheme.body}`}
  class:speaker-character-generic={speaker.kind === 'character'}
  data-speaker-kind={speaker.kind}
  data-speaker-key={speaker.key}
>
  <span class={`mr-2 text-xs font-bold uppercase tracking-wide ${speakerTheme.label}`}
    >{speaker.label}:</span
  >
  <span>{text}</span>
</div>
