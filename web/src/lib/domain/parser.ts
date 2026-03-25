export type GameMode = 'explore' | 'talk' | 'accuse' | 'ended';

export interface ParseContext {
  locations: Array<{ id: string; name: string }>;
  characters: Array<{ first_name: string; last_name: string; location_name: string }>;
  currentLocation: string;
}

export type ActionCommand =
  | { type: 'move'; destination: string }
  | { type: 'search' }
  | { type: 'talk'; character_name: string }
  | { type: 'ask'; question: string }
  | { type: 'accuse'; reasoning: string | null }
  | { type: 'end_talk' };

export type ListItem =
  | { kind: 'location'; name: string; characters: string[] }
  | { kind: 'character'; displayName: string };

export type ParseResult =
  | { type: 'valid'; command: ActionCommand }
  | { type: 'missing-target'; commandType: 'move' | 'talk'; suggestions: string[] }
  | {
      type: 'invalid-target';
      commandType: 'move' | 'talk';
      attempted: string;
      suggestions: string[];
    }
  | { type: 'list'; listType: 'locations' | 'characters'; items: ListItem[] }
  | { type: 'unrecognized'; raw: string; hint: string }
  | { type: 'help' }
  | { type: 'quit' }
  | { type: 'theme-list' }
  | { type: 'theme-set'; themeName: string }
  | { type: 'zoom' };

const MOVE_ALIASES = ['head towards', 'travel to', 'move to', 'go to', 'move', 'go'] as const;
const TALK_ALIASES = ['speak with', 'speak to', 'talk to'] as const;
const ACCUSE_ALIASES = ['accuse'] as const;
const SEARCH_ALIASES = ['look around', 'inspect', 'search', 'look'] as const;
const LOCATION_LIST_ALIASES = ['where can i go', 'locations'] as const;
const CHARACTER_LIST_ALIASES = ['who is here', 'characters'] as const;
const HELP_ALIASES = ['help'] as const;
const QUIT_ALIASES = ['quit', 'exit'] as const;
const END_TALK_ALIASES = ['goodbye', 'see you', 'leave', 'bye', 'end'] as const;
const THEME_LIST_ALIASES = ['themes'] as const;
const THEME_SET_PREFIX = 'theme' as const;
const ZOOM_ALIASES = ['zoom'] as const;

const MODE_HINTS: Record<GameMode, string> = {
  explore:
    "Commands: move to/go to <location>, talk to <character>, search, accuse [statement], locations, characters, help, quit. Type 'help' for details.",
  talk: "Commands: <question>, bye, help, quit. Type 'help' for details.",
  accuse: "Commands: <reasoning>, help, quit. Type 'help' for details.",
  ended: "Commands: help, quit. Type 'help' for details.",
};

const TRAILING_PUNCTUATION = /[!?.,]+$/g;
const WHITESPACE = /\s+/g;

function isAliasExact(input: string, aliases: readonly string[]): boolean {
  return aliases.includes(input);
}

function isAliasPrefix(input: string, alias: string): boolean {
  return input === alias || input.startsWith(`${alias} `);
}

function extractAliasTarget(input: string, alias: string): string {
  if (input === alias) {
    return '';
  }
  return input.slice(alias.length).trim();
}

function normalizeTargetForMatch(target: string): string {
  return normalizeInput(target).replace(/^the\s+/, '').trim();
}

function displayNameOf(character: ParseContext['characters'][number]): string {
  return `${character.first_name} ${character.last_name}`.trim();
}

function getCharactersInCurrentLocation(context: ParseContext): ParseContext['characters'] {
  const current = normalizeInput(context.currentLocation);
  return context.characters.filter((character) => normalizeInput(character.location_name) === current);
}

function uniqueNames(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeInput(value);
    if (normalized === '' || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(value);
  }

  return result;
}

function movementSuggestions(context: ParseContext): string[] {
  const locations = context.locations.map((location) => location.name);
  const characterNames = getCharactersInCurrentLocation(context).map(displayNameOf);
  return uniqueNames([...locations, ...characterNames]);
}

function sceneCharacterSuggestions(context: ParseContext): string[] {
  return uniqueNames(getCharactersInCurrentLocation(context).map(displayNameOf));
}

function resolveLocation(target: string, context: ParseContext): string | null {
  const normalizedTarget = normalizeTargetForMatch(target);

  // Exact ID match
  for (const location of context.locations) {
    if (location.id.toLowerCase() === normalizedTarget) {
      return location.id;
    }
  }

  // Full name match
  for (const location of context.locations) {
    if (normalizeTargetForMatch(location.name) === normalizedTarget) {
      return location.id;
    }
  }

  // Partial match: any single word of the location name
  for (const location of context.locations) {
    const words = normalizeTargetForMatch(location.name).split(/\s+/);
    if (words.some((word) => word === normalizedTarget)) {
      return location.id;
    }
  }

  return null;
}

function resolveSceneCharacter(target: string, context: ParseContext): string | null {
  const normalizedTarget = normalizeInput(target);
  for (const character of getCharactersInCurrentLocation(context)) {
    const first = normalizeInput(character.first_name);
    const last = normalizeInput(character.last_name);
    const full = normalizeInput(displayNameOf(character));

    if (normalizedTarget === first || normalizedTarget === last || normalizedTarget === full) {
      return character.first_name;
    }
  }
  return null;
}

function locationItems(context: ParseContext): ListItem[] {
  return context.locations.map((location) => {
    const characters = context.characters
      .filter((character) => {
        const locName = normalizeInput(character.location_name);
        return locName === normalizeInput(location.id) || locName === normalizeInput(location.name);
      })
      .map(displayNameOf);

    return {
      kind: 'location',
      name: location.name,
      characters,
    };
  });
}

function characterItems(context: ParseContext): ListItem[] {
  const visibleCharacters = getCharactersInCurrentLocation(context);
  return visibleCharacters.map((character) => ({
    kind: 'character',
    displayName: displayNameOf(character),
  }));
}

function parseExploreCommand(text: string, rawInput: string, context: ParseContext): ParseResult {
  if (text === '') {
    return { type: 'unrecognized', raw: rawInput, hint: MODE_HINTS.explore };
  }

  if (isAliasExact(text, HELP_ALIASES)) {
    return { type: 'help' };
  }

  if (isAliasExact(text, QUIT_ALIASES)) {
    return { type: 'quit' };
  }

  if (isAliasExact(text, LOCATION_LIST_ALIASES)) {
    return {
      type: 'list',
      listType: 'locations',
      items: locationItems(context),
    };
  }

  if (isAliasExact(text, CHARACTER_LIST_ALIASES)) {
    return {
      type: 'list',
      listType: 'characters',
      items: characterItems(context),
    };
  }

  for (const alias of SEARCH_ALIASES) {
    if (isAliasPrefix(text, alias)) {
      return { type: 'valid', command: { type: 'search' } };
    }
  }

  for (const alias of MOVE_ALIASES) {
    if (!isAliasPrefix(text, alias)) {
      continue;
    }

    const target = extractAliasTarget(text, alias);
    if (target === '') {
      return {
        type: 'missing-target',
        commandType: 'move',
        suggestions: movementSuggestions(context),
      };
    }

    const destination = resolveLocation(target, context);
    if (!destination) {
      return {
        type: 'invalid-target',
        commandType: 'move',
        attempted: target,
        suggestions: movementSuggestions(context),
      };
    }

    return {
      type: 'valid',
      command: { type: 'move', destination },
    };
  }

  for (const alias of TALK_ALIASES) {
    if (!isAliasPrefix(text, alias)) {
      continue;
    }

    const target = extractAliasTarget(text, alias);
    if (target === '') {
      return {
        type: 'missing-target',
        commandType: 'talk',
        suggestions: sceneCharacterSuggestions(context),
      };
    }

    const characterName = resolveSceneCharacter(target, context);
    if (!characterName) {
      return {
        type: 'invalid-target',
        commandType: 'talk',
        attempted: target,
        suggestions: sceneCharacterSuggestions(context),
      };
    }

    return {
      type: 'valid',
      command: { type: 'talk', character_name: characterName },
    };
  }

  for (const alias of ACCUSE_ALIASES) {
    if (!isAliasPrefix(text, alias)) {
      continue;
    }

    const target = extractAliasTarget(text, alias);
    return {
      type: 'valid',
      command: { type: 'accuse', reasoning: target === '' ? null : rawInput.trim().slice(alias.length).trim() || target },
    };
  }

  return {
    type: 'unrecognized',
    raw: rawInput,
    hint: MODE_HINTS.explore,
  };
}

function parseTalkCommand(text: string, rawInput: string): ParseResult {
  if (text === '') {
    return { type: 'unrecognized', raw: rawInput, hint: MODE_HINTS.talk };
  }

  if (isAliasExact(text, HELP_ALIASES)) {
    return { type: 'help' };
  }

  if (isAliasExact(text, QUIT_ALIASES)) {
    return { type: 'quit' };
  }

  if (isAliasExact(text, END_TALK_ALIASES)) {
    return {
      type: 'valid',
      command: { type: 'end_talk' },
    };
  }

  return {
    type: 'valid',
    command: { type: 'ask', question: rawInput.trim() },
  };
}

function parseAccuseCommand(text: string, rawInput: string): ParseResult {
  if (text === '') {
    return { type: 'unrecognized', raw: rawInput, hint: MODE_HINTS.accuse };
  }

  if (isAliasExact(text, HELP_ALIASES)) {
    return { type: 'help' };
  }

  if (isAliasExact(text, QUIT_ALIASES)) {
    return { type: 'quit' };
  }

  return {
    type: 'valid',
    command: { type: 'ask', question: rawInput.trim() },
  };
}

function parseEndedCommand(text: string, rawInput: string): ParseResult {
  if (isAliasExact(text, HELP_ALIASES)) {
    return { type: 'help' };
  }

  if (isAliasExact(text, QUIT_ALIASES)) {
    return { type: 'quit' };
  }

  return {
    type: 'unrecognized',
    raw: rawInput,
    hint: MODE_HINTS.ended,
  };
}

export function normalizeInput(rawInput: string): string {
  return rawInput
    .trim()
    .toLowerCase()
    .replace(WHITESPACE, ' ')
    .replace(TRAILING_PUNCTUATION, '')
    .trim();
}

function parseGlobalCommand(text: string): ParseResult | null {
  if (isAliasExact(text, THEME_LIST_ALIASES)) {
    return { type: 'theme-list' };
  }

  if (isAliasPrefix(text, THEME_SET_PREFIX)) {
    const target = extractAliasTarget(text, THEME_SET_PREFIX);
    if (target !== '') {
      return { type: 'theme-set', themeName: target };
    }
  }

  if (isAliasExact(text, ZOOM_ALIASES)) {
    return { type: 'zoom' };
  }

  return null;
}

export function parseCommand(rawInput: string, mode: GameMode, context: ParseContext): ParseResult {
  const normalized = normalizeInput(rawInput);

  const globalResult = parseGlobalCommand(normalized);
  if (globalResult) {
    return globalResult;
  }

  switch (mode) {
    case 'explore':
      return parseExploreCommand(normalized, rawInput, context);
    case 'talk':
      return parseTalkCommand(normalized, rawInput);
    case 'accuse':
      return parseAccuseCommand(normalized, rawInput);
    case 'ended':
      return parseEndedCommand(normalized, rawInput);
    default:
      return {
        type: 'unrecognized',
        raw: rawInput,
        hint: MODE_HINTS.explore,
      };
  }
}
