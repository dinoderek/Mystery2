/**
 * The one bounded worker pool: runs `work` over `items` with at most `limit`
 * running at once, and returns the results in the items' order.
 *
 * When one item throws, no new item starts; the pool waits for the ones
 * already running and then throws the first error. A caller that wants every
 * item to finish catches inside `work`.
 */
export async function mapPool<I, O>(
  items: readonly I[],
  limit: number,
  work: (item: I, index: number) => Promise<O>,
): Promise<O[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`pool limit must be a positive integer, got ${limit}`);
  }
  const results = new Array<O>(items.length);
  let next = 0;
  let failure: { error: unknown } | null = null;

  async function lane(): Promise<void> {
    while (next < items.length && !failure) {
      const index = next;
      next += 1;
      try {
        results[index] = await work(items[index], index);
      } catch (error) {
        failure ??= { error };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  if (failure) throw (failure as { error: unknown }).error;
  return results;
}
