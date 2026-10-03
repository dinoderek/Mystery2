<script lang="ts">
  import type { Speaker, SpeakerKind } from '$lib/types/game';

  let { text, speaker }: { text: string; speaker: Speaker } = $props();

  // Every character shares one style: telling them apart is the label's job.
  const SPEAKER_CLASSES: Record<SpeakerKind, { label: string; body: string }> = {
    investigator: { label: 'text-t-bright', body: 'text-t-investigator-text' },
    narrator: { label: 'text-t-narrator', body: 'text-t-narrator-text' },
    character: { label: 'text-t-dialogue', body: 'text-t-dialogue-text tracking-[0.01em]' },
    system: { label: 'text-t-system', body: 'text-t-system-text' },
  };

  const classes = $derived(SPEAKER_CLASSES[speaker.kind]);
</script>

<div
  class={`terminal-message mb-6 pl-2 text-sm leading-relaxed text-shadow-glow-soft ${classes.body}`}
  data-speaker-kind={speaker.kind}
  data-speaker-key={speaker.key}
>
  <span class={`mr-2 text-sm font-bold uppercase tracking-wide text-shadow-glow ${classes.label}`}
    >{speaker.label}:</span
  >
  <span class="whitespace-pre-line">{text}</span>
</div>
