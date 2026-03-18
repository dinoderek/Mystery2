export interface NarrationPart {
  type: "text";
  text: string;
}

export function createNarrationParts(narration: string): NarrationPart[] {
  return [{ type: "text", text: narration }];
}
