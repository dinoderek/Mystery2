/**
 * JSON Patch (RFC 6902) for the four operations a plant uses: `test`,
 * `replace`, `add` and `remove`. A patch is applied to a copy, so the subject
 * it was written for is never changed, and a patch that does not fit fails
 * with the operation and why, never half-applies.
 */

import { isDeepStrictEqual } from "node:util";

import type { PatchOp } from "./schemas.ts";

/** A patch that does not fit the document it was applied to. */
export class PatchError extends Error {
  constructor(index: number, op: PatchOp, detail: string) {
    super(`operation ${index + 1} (${op.op} ${op.path}): ${detail}`);
    this.name = "PatchError";
  }
}

export interface Patched<T = unknown> {
  value: T;
  /**
   * Where the patch changed the document, as JSON pointers: the place an
   * operation names, or the array it inserted into or removed from, since that
   * shifts the elements after it.
   */
  touched: string[];
}

type Container = Record<string, unknown> | unknown[];

const ARRAY_INDEX = /^(0|[1-9]\d*)$/;

function isContainer(value: unknown): value is Container {
  return typeof value === "object" && value !== null;
}

function segmentsOf(pointer: string): string[] {
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function show(value: unknown): string {
  const text = JSON.stringify(value) ?? "undefined";
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function hasKey(container: Container, key: string): boolean {
  if (Array.isArray(container)) return ARRAY_INDEX.test(key) && Number(key) < container.length;
  return Object.hasOwn(container, key);
}

function read(container: Container, key: string): unknown {
  return Array.isArray(container) ? container[Number(key)] : container[key];
}

/** The container the operation's last segment sits in, walking the rest. */
function parentOf(root: unknown, keys: readonly string[], fail: (detail: string) => never): Container {
  let node = root;
  for (const key of keys.slice(0, -1)) {
    if (!isContainer(node) || !hasKey(node, key)) fail(`nothing at "${key}" on the way`);
    node = read(node as Container, key);
  }
  if (!isContainer(node)) fail("the parent is not an object or array");
  return node as Container;
}

function insert(parent: Container, key: string, value: unknown, fail: (detail: string) => never): void {
  if (!Array.isArray(parent)) {
    parent[key] = value;
    return;
  }
  if (key === "-") {
    parent.push(value);
  } else if (ARRAY_INDEX.test(key) && Number(key) <= parent.length) {
    parent.splice(Number(key), 0, value);
  } else {
    fail(`"${key}" is not a place in an array of ${parent.length}`);
  }
}

function applyOne(root: unknown, op: PatchOp, fail: (detail: string) => never): string | null {
  const keys = segmentsOf(op.path);
  const key = keys[keys.length - 1];
  const parent = parentOf(root, keys, fail);
  if (op.op === "add") {
    insert(parent, key, op.value, fail);
    return Array.isArray(parent) ? op.path.slice(0, op.path.lastIndexOf("/")) : op.path;
  }
  if (!hasKey(parent, key)) fail("nothing there");
  if (op.op === "test") {
    const found = read(parent, key);
    if (!isDeepStrictEqual(found, op.value)) fail(`expected ${show(op.value)}, found ${show(found)}`);
    return null;
  }
  if (op.op === "replace") {
    if (Array.isArray(parent)) parent[Number(key)] = op.value;
    else parent[key] = op.value;
    return op.path;
  }
  if (Array.isArray(parent)) {
    parent.splice(Number(key), 1);
    return op.path.slice(0, op.path.lastIndexOf("/"));
  }
  delete parent[key];
  return op.path;
}

/** Applies `ops` in order to a copy of `target`. Throws a `PatchError` on the first that does not fit. */
export function applyPatch<T>(target: T, ops: readonly PatchOp[]): Patched<T> {
  const value = structuredClone(target);
  const touched = new Set<string>();
  ops.forEach((op, index) => {
    const fail = (detail: string): never => {
      throw new PatchError(index, op, detail);
    };
    const changed = applyOne(value, op, fail);
    if (changed !== null) touched.add(changed);
  });
  return { value, touched: [...touched] };
}

/** The pointers where `a` and `b` differ, an array of another length counting as one difference at the array. */
export function changedPaths(a: unknown, b: unknown, at = ""): string[] {
  if (isDeepStrictEqual(a, b)) return [];
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    return a.flatMap((item, index) => changedPaths(item, b[index], `${at}/${index}`));
  }
  if (isContainer(a) && isContainer(b) && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((key) => {
      const place = `${at}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
      const one = a as Record<string, unknown>;
      const two = b as Record<string, unknown>;
      return Object.hasOwn(one, key) && Object.hasOwn(two, key) ? changedPaths(one[key], two[key], place) : [place];
    });
  }
  return [at];
}

/** Whether `path` is `within` or below it. */
export function isWithin(path: string, within: string): boolean {
  return path === within || path.startsWith(`${within}/`);
}
