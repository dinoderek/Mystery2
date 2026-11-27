import ts from "typescript";

import type { BaselineSources } from "../../core/baseline-sources.ts";
import { contentHash } from "../../core/suite-attributes.ts";

const PROMPTS = "packages/game-engine/src/clue-graph/prompts.ts";
const ACCUSATION = "packages/game-engine/src/clue-graph/judge-guidance.ts";
const TEMPLATES = "packages/game-engine/src/ai-prompts.ts";

const PIECES = {
  talk: { [PROMPTS]: ["GRAPH_TALK_PROMPT", "GRAPH_TALK_GREETING_TURN", "GRAPH_TALK_LINE_TURN", "GRAPH_TALK_EARLIER_LINES"], [TEMPLATES]: ["talk_end"] },
  search: { [PROMPTS]: ["GRAPH_SEARCH_PROMPT"] },
  accusation: { [ACCUSATION]: ["GRAPH_ACCUSATION_PROMPT", "GRAPH_ACCUSATION_ROUND_PROMPT", "GRAPH_ENDING_PROMPT"], [TEMPLATES]: ["accusation_start"] },
  opening: { [TEMPLATES]: ["buildGameStartPrompt"] },
  movement: { [TEMPLATES]: ["buildGameMovePrompt"] },
} satisfies Record<string, Record<string, string[]>>;

export type PromptFamily = keyof typeof PIECES;
export const PROMPT_FAMILIES = Object.keys(PIECES) as PromptFamily[];

export function promptFamily(action: string): PromptFamily | null {
  if (["talk", "ask", "end_talk"].includes(action)) return "talk";
  if (action === "accuse") return "accusation";
  if (action === "start") return "opening";
  if (action === "move") return "movement";
  return action === "search" ? "search" : null;
}

function promptNodes(source: ts.SourceFile): Map<string, ts.Node> {
  const nodes = new Map<string, ts.Node>();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) nodes.set(statement.name.text, statement.body);
    if (!ts.isVariableStatement(statement)) continue;
    for (const { name, initializer } of statement.declarationList.declarations) {
      if (!ts.isIdentifier(name) || !initializer) continue;
      nodes.set(name.text, initializer);
      if (name.text !== "PROMPT_TEMPLATE_BY_ROLE" || !ts.isObjectLiteralExpression(initializer)) continue;
      for (const property of initializer.properties) {
        if (ts.isPropertyAssignment(property)) nodes.set(property.name.getText(source), property.initializer);
      }
    }
  }
  return nodes;
}

function sharedText(source: string, nodes: readonly ts.Node[]): string {
  const spans = nodes.map((node) => ({ start: node.getStart(), end: node.getEnd() })).sort((a, b) => b.start - a.start);
  for (const { start, end } of spans) source = `${source.slice(0, start)}<prompt>${source.slice(end)}`;
  return source;
}

/** Name the templates independently and leave all surrounding assembly code in the shared inputs. */
export function baselinePrompts(sources: BaselineSources) {
  const files = new Map<string, Set<string>>();
  for (const family of Object.values(PIECES)) {
    for (const [file, names] of Object.entries(family)) files.set(file, new Set([...(files.get(file) ?? []), ...names]));
  }
  const pieces = new Map<string, Map<string, string>>();
  const shared = new Map<string, string | null>();
  for (const [file, names] of files) {
    const text = sources.text(file);
    if (text === null) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const nodes = promptNodes(source);
    const selected = [...names].flatMap((name) => nodes.has(name) ? [[name, nodes.get(name) as ts.Node] as const] : []);
    pieces.set(file, new Map(selected.map(([name, node]) => [name, node.getText(source)])));
    shared.set(file, contentHash(sharedText(text, selected.map(([, node]) => node))));
  }
  return {
    shared,
    family(family: PromptFamily) {
      return Object.entries(PIECES[family]).map(([file, names]) => {
        const values = names.map((name: string) => pieces.get(file)?.get(name));
        return [file, values.every((value: string | undefined) => value !== undefined) ? contentHash(values) : null] as const;
      });
    },
  };
}
