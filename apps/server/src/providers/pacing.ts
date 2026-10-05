// Pacing per Connection (ADR 0024, 0027): actions on one Connection run one after another, with the Provider's pause
// between them. A second request waits its turn instead of failing. In one process, like the Dive lock.

export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createPacer(options: { sleep?: Sleep; now?: () => number } = {}) {
  const sleep = options.sleep ?? realSleep;
  const now = options.now ?? Date.now;
  const lanes = new Map<string, { tail: Promise<unknown>; lastEnd: number }>();

  /** Runs `fn` after the actions already queued for `key`, at least `pauseMs` after the last one ended. */
  return function paced<T>(key: string, pauseMs: number, fn: () => Promise<T>): Promise<T> {
    const lane = lanes.get(key) ?? { tail: Promise.resolve(), lastEnd: Number.NEGATIVE_INFINITY };
    lanes.set(key, lane);
    const run = lane.tail.then(async () => {
      const wait = lane.lastEnd + pauseMs - now();
      if (wait > 0) await sleep(wait);
      try {
        return await fn();
      } finally {
        lane.lastEnd = now();
      }
    });
    lane.tail = run.catch(() => undefined);
    return run;
  };
}

export type Pacer = ReturnType<typeof createPacer>;
