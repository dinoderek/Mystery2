// Blueprint image identity.
//
// An image id is a filename carrying a uuid, so a given id always names the
// same bytes. That is what makes `/api/images/<blueprint>/<image>` a permanent
// URL, and why nothing here deals in signatures, expiry, or buckets any more.

import { isCanonicalImageId } from "../../shared/src/image-ids.ts";

export { isCanonicalImageId };

/** The id, or null when it is not a canonical image filename. */
export function ensureCanonicalImageId(value: unknown): string | null {
  return isCanonicalImageId(value) ? value : null;
}

/** How an image is addressed within a blueprint: `<blueprint id>/<filename>`. */
export function buildImageStorageKey(
  blueprintId: string,
  imageFilename: string,
): string {
  return `${blueprintId}/${imageFilename}`;
}
