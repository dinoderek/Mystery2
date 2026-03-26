import { readFile } from "node:fs/promises";

import {
  buildBlueprintGenerationChatInput,
  StoryBriefSchema,
  type StoryBrief,
} from "./index.ts";

const STORY_BRIEF_SCHEMA_URL = new URL("./story-brief.ts", import.meta.url);
const BLUEPRINT_SCHEMA_URL = new URL(
  "../../shared/src/blueprint-schema-v2.ts",
  import.meta.url,
);

function formatJsonBlock(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export interface BuildBlueprintGenerationMarkdownOptions {
  storyBrief: StoryBrief;
  title?: string;
}

export interface BlueprintGenerationMarkdownPacket {
  outputText: string;
  responseSchema: Record<string, unknown>;
  storyBrief: StoryBrief;
}

export function buildBlueprintGenerationMarkdownDocument({
  title = "Blueprint Generation Packet",
  systemPrompt,
  userMessageJson,
  responseSchema,
  storyBriefSchemaSource,
  blueprintSchemaSource,
}: {
  blueprintSchemaSource: string;
  responseSchema: Record<string, unknown>;
  storyBriefSchemaSource: string;
  systemPrompt: string;
  title?: string;
  userMessageJson: Record<string, unknown>;
}): string {
  const operatorNotes = [
    "Use this document as the complete input packet for a blueprint generation run in a chat window.",
    "",
    "Operator checklist:",
    "1. Paste the full packet into a chat model.",
    "2. Ask for JSON only with no code fences or commentary.",
    "3. Save the response to a blueprint JSON file.",
    "4. Run `npm run validate:blueprint -- <path-to-file>` after saving.",
    "5. Optionally run the existing evaluation packet flow for a second-pass review.",
  ].join("\n");

  return `# ${title}

${operatorNotes}

## Generator Prompt

\`\`\`text
${systemPrompt.trim()}
\`\`\`

## User Message JSON

\`\`\`json
${formatJsonBlock(userMessageJson).trimEnd()}
\`\`\`

## Response Contract

- Return JSON only.
- Do not wrap the JSON in markdown fences.
- Match the provided response schema.
- Do not output generated image fields such as \`image_id\`, \`location_image_id\`, or \`portrait_image_id\`.

## Response Schema (JSON Schema)

\`\`\`json
${formatJsonBlock(responseSchema).trimEnd()}
\`\`\`

## Story Brief Schema Reference

\`\`\`ts
${storyBriefSchemaSource.trim()}
\`\`\`

## Blueprint V2 Schema Reference

\`\`\`ts
${blueprintSchemaSource.trim()}
\`\`\`
`;
}

export async function buildBlueprintGenerationMarkdownPacket({
  storyBrief,
  title,
}: BuildBlueprintGenerationMarkdownOptions): Promise<BlueprintGenerationMarkdownPacket> {
  const parsedStoryBrief = StoryBriefSchema.parse(storyBrief);
  const [chatInput, storyBriefSchemaSource, blueprintSchemaSource] =
    await Promise.all([
      buildBlueprintGenerationChatInput(parsedStoryBrief),
      readFile(STORY_BRIEF_SCHEMA_URL, "utf-8"),
      readFile(BLUEPRINT_SCHEMA_URL, "utf-8"),
    ]);

  return {
    storyBrief: parsedStoryBrief,
    responseSchema: chatInput.responseSchema,
    outputText: buildBlueprintGenerationMarkdownDocument({
      title,
      systemPrompt: chatInput.systemPrompt,
      userMessageJson: JSON.parse(chatInput.userMessageContent) as Record<
        string,
        unknown
      >,
      responseSchema: chatInput.responseSchema,
      storyBriefSchemaSource,
      blueprintSchemaSource,
    }),
  };
}
