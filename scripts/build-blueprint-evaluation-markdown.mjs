import fs from "node:fs/promises";

import { StoryBriefSchema } from "../packages/blueprint-generator/src/story-brief.ts";
import { BlueprintSchema } from "../packages/shared/src/blueprint-schema.ts";
import { BLUEPRINT_EVALUATION_PROMPT } from "../packages/shared/src/evaluation/prompt.ts";

const EVALUATION_SCHEMA_URL = new URL(
  "../packages/shared/src/evaluation/schema.ts",
  import.meta.url,
);
const STORY_BRIEF_SCHEMA_URL = new URL(
  "../packages/blueprint-generator/src/story-brief.ts",
  import.meta.url,
);
const BLUEPRINT_SCHEMA_URL = new URL(
  "../packages/shared/src/blueprint-schema.ts",
  import.meta.url,
);

export function parseBuildBlueprintEvaluationMarkdownArgs(argv) {
  const options = {
    briefFile: "",
    blueprintFile: "",
    output: "",
    title: "Blueprint Evaluation Packet",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--brief-file") {
      options.briefFile = String(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (token === "--blueprint-file") {
      options.blueprintFile = String(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (token === "--output") {
      options.output = String(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (token === "--title") {
      options.title = String(argv[index + 1] ?? "");
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${token}`);
  }

  if (!options.briefFile) {
    throw new Error("Missing required --brief-file");
  }
  if (!options.blueprintFile) {
    throw new Error("Missing required --blueprint-file");
  }
  if (!options.title.trim()) {
    throw new Error("Missing required value for --title");
  }

  return options;
}

function formatJsonBlock(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function buildBlueprintEvaluationMarkdownDocument({
  title,
  storyBrief,
  blueprint,
  prompt = BLUEPRINT_EVALUATION_PROMPT,
  evaluationSchemaSource,
  storyBriefSchemaSource,
  blueprintSchemaSource,
}) {
  return `# ${title}

Use this document as the complete input packet for a blueprint evaluation in a chat window.

The AI should:

1. follow the evaluator prompt exactly
2. return JSON only
3. match the output schema guidance
4. evaluate the concrete story brief and blueprint included below

## Evaluator Prompt

\`\`\`text
${prompt.trim()}
\`\`\`

## Output Schema (Zod Source)

\`\`\`ts
${evaluationSchemaSource.trim()}
\`\`\`

## Story Brief Schema Reference

\`\`\`ts
${storyBriefSchemaSource.trim()}
\`\`\`

## Blueprint Schema Reference

\`\`\`ts
${blueprintSchemaSource.trim()}
\`\`\`

## Story Brief JSON

\`\`\`json
${formatJsonBlock(storyBrief).trimEnd()}
\`\`\`

## Blueprint JSON

\`\`\`json
${formatJsonBlock(blueprint).trimEnd()}
\`\`\`
`;
}

export async function runBuildBlueprintEvaluationMarkdownCli(
  options,
  dependencies = {},
) {
  const readFile = dependencies.readFile ?? fs.readFile;
  const writeFile = dependencies.writeFile ?? fs.writeFile;

  const storyBrief = StoryBriefSchema.parse(
    JSON.parse(await readFile(options.briefFile, "utf-8")),
  );
  const blueprint = BlueprintSchema.parse(
    JSON.parse(await readFile(options.blueprintFile, "utf-8")),
  );

  const [evaluationSchemaSource, storyBriefSchemaSource, blueprintSchemaSource] =
    await Promise.all([
      readFile(EVALUATION_SCHEMA_URL, "utf-8"),
      readFile(STORY_BRIEF_SCHEMA_URL, "utf-8"),
      readFile(BLUEPRINT_SCHEMA_URL, "utf-8"),
    ]);

  const outputText = buildBlueprintEvaluationMarkdownDocument({
    title: options.title,
    storyBrief,
    blueprint,
    evaluationSchemaSource,
    storyBriefSchemaSource,
    blueprintSchemaSource,
  });

  if (options.output) {
    await writeFile(options.output, outputText, "utf-8");
  }

  return {
    outputText,
    storyBrief,
    blueprint,
  };
}

async function main() {
  try {
    const options = parseBuildBlueprintEvaluationMarkdownArgs(
      process.argv.slice(2),
    );
    const result = await runBuildBlueprintEvaluationMarkdownCli(options);

    if (!options.output) {
      process.stdout.write(result.outputText);
    }
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
