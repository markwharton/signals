/**
 * Bounded-concurrency task runner. Dispatches `tasks` through at most
 * `concurrency` workers and preserves input order in the result array —
 * callers can rely on `results[i]` pairing with `tasks[i]`.
 *
 * Used on the summary read path (days × dimensions fan-out) and the daily
 * monthly-tier rebuild. Inline alternative to pulling p-limit for 15 lines
 * of code.
 */
export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]();
    }
  };
  const n = Math.max(1, Math.min(concurrency, tasks.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}
