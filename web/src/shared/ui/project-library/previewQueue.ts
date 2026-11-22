/** A client-owned queue. Aborted callers never start work after leaving the list. */
export class PreviewQueue {
  private active = 0;
  private waiting: Array<() => void> = [];
  constructor(private readonly limit: number) {}

  async run<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const start = () => {
        signal.removeEventListener("abort", cancel);
        this.active++;
        resolve();
      };
      const cancel = () => {
        this.waiting = this.waiting.filter((entry) => entry !== start);
        reject(signal.reason);
      };
      if (this.active < this.limit) start();
      else {
        this.waiting.push(start);
        signal.addEventListener("abort", cancel, { once: true });
      }
    });
    try {
      signal.throwIfAborted();
      return await action();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}
