import type { AgentAccess } from './types.js';

export class InferenceScheduler {
  private readonly modelSlots = new Map<string, Semaphore>();
  private readonly writeSlot = new Semaphore(1);

  constructor(private readonly readOnlyConcurrency: number) {}

  async schedule<T>(modelKey: string, access: AgentAccess, signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    const modelSlot = this.modelSlots.get(modelKey) ?? new Semaphore(this.readOnlyConcurrency);
    this.modelSlots.set(modelKey, modelSlot);
    const releaseWrite = access === 'write' ? await this.writeSlot.acquire(signal) : undefined;
    try {
      const releaseModel = await modelSlot.acquire(signal);
      try {
        if (signal.aborted) throw abortError();
        return await operation();
      }
      finally { releaseModel(); }
    } finally { releaseWrite?.(); }
  }
}

class Semaphore {
  private active = 0;
  private readonly queue: { resolve: (release: () => void) => void; reject: (error: Error) => void; signal: AbortSignal; onAbort: () => void }[] = [];
  constructor(private readonly limit: number) {}

  acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(abortError());
    if (this.active < this.limit) { this.active++; return Promise.resolve(this.release()); }
    return new Promise((resolve, reject) => {
      const queued = { resolve, reject, signal, onAbort: () => {
        const index = this.queue.indexOf(queued);
        if (index >= 0) this.queue.splice(index, 1);
        reject(abortError());
      } };
      signal.addEventListener('abort', queued.onAbort, { once: true });
      this.queue.push(queued);
    });
  }

  private release(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next) { next.signal.removeEventListener('abort', next.onAbort); next.resolve(this.release()); }
      else this.active--;
    };
  }
}

function abortError(): Error { const error = new Error('Agent inference was cancelled.'); error.name = 'AbortError'; return error; }
