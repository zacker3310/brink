import type { Envelope, Request, Response } from './protocol';

/** Promise wrapper around the engine worker. */
class Engine {
  private worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
  private next = 1;
  private pending = new Map<number, (r: Response) => void>();

  constructor() {
    this.worker.onmessage = (e: MessageEvent<Envelope<Response>>) => {
      const done = this.pending.get(e.data.id);
      this.pending.delete(e.data.id);
      done?.(e.data.body);
    };
  }

  call(body: Request): Promise<Response> {
    const id = this.next++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker.postMessage({ id, body } satisfies Envelope<Request>);
    });
  }
}

export const engine = new Engine();
