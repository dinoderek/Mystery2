// The logic behind `check-curated-docs.mjs`, kept free of I/O so it can be
// unit-tested.
//
// A curated extract pins each source it was derived from:
//
//   > Source git blob hashes:
//   > - `docs/game.md#commands` — `<sha>`
//   > - `packages/blueprint-generator/src/story-brief.ts` — `<sha>`
//
// A `#<id>` suffix pins one marked section of a Markdown source:
//
//   <!-- extract:commands -->
//   ...
//   <!-- /extract:commands -->
//
// and its hash covers that section only, so an edit elsewhere in the doc does
// not ask anyone to re-review the extract. The section's whitespace is collapsed
// before hashing: re-wrapping a paragraph changes no words, and must not count
// as drift. Without a suffix the pin is the file's git blob hash, which is what
// a code source wants — any change to it may change what the extract says.

import crypto from "node:crypto";

const LIST_ITEM_RE = /^>\s*-\s*`([^`]+)`\s*[—-]\s*`([0-9a-f]{40})`\s*$/;
const SINGLE_HASH_RE = /^>\s*Source git blob hash:\s*`([0-9a-f]{40})`\s*$/m;
const SINGLE_SOURCE_RE = /^>\s*Source:\s*`([^`]+)`\s*$/m;
const MARKER_RE = /<!--\s*(\/?)extract:([a-z0-9][a-z0-9-]*)\s*-->/g;

/** `path#section` → `{ path, section }`; no suffix → `section: null`. */
export function splitPin(pin) {
  const hash = pin.indexOf("#");
  if (hash === -1) return { path: pin, section: null };
  return { path: pin.slice(0, hash), section: pin.slice(hash + 1) };
}

/** Every (pin, expected hash) pair in an extract's header block. */
export function parsePins(content) {
  const pins = [];
  const seen = new Set();
  const push = (pin, expected) => {
    const key = `${pin} ${expected}`;
    if (seen.has(key)) return;
    seen.add(key);
    pins.push({ ...splitPin(pin), pin, expected });
  };

  for (const line of content.split("\n")) {
    const m = line.match(LIST_ITEM_RE);
    if (m) push(m[1], m[2]);
  }
  // The single-source form. Checked even when list items exist, so a header
  // carrying both forms cannot have one silently skipped.
  const src = content.match(SINGLE_SOURCE_RE);
  const hash = content.match(SINGLE_HASH_RE);
  if (src && hash) push(src[1], hash[1]);
  return pins;
}

/**
 * Every marked section in a source, by id, or the problems that make the
 * markers unusable. A section may contain another; the same id may open only
 * once.
 */
export function parseSections(text) {
  const sections = new Map();
  const errors = [];
  const open = new Map();

  for (const m of text.matchAll(MARKER_RE)) {
    const [marker, closing, id] = m;
    if (!closing) {
      if (open.has(id) || sections.has(id)) {
        errors.push(`section "${id}" is opened more than once`);
        continue;
      }
      open.set(id, m.index + marker.length);
    } else if (!open.has(id)) {
      errors.push(`section "${id}" is closed without being opened`);
    } else {
      sections.set(id, text.slice(open.get(id), m.index));
      open.delete(id);
    }
  }
  for (const id of open.keys()) errors.push(`section "${id}" is never closed`);
  return { sections, errors };
}

/** The hash a `#section` pin records: SHA-1 of the section's words. */
export function sectionHash(body) {
  const words = body
    .replace(MARKER_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  return crypto.createHash("sha1").update(words).digest("hex");
}
