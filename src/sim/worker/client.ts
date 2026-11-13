import type { SimCommand, SimFrame, SimResponse } from './protocol';

export interface SimClientHandlers {
  onFrame: (frame: SimFrame, command: SimCommand['type']) => void;
  onError?: (message: string) => void;
}

/**
 * UI-thread handle on the simulation worker.
 *
 * Responses arrive in the order commands were sent, so a simple queue of
 * pending command types is enough to tell which command a frame answers.
 */
export class SimClient {
  private readonly worker: Worker;
  private readonly pending: SimCommand['type'][] = [];

  constructor(handlers: SimClientHandlers) {
    this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<SimResponse>) => {
      const command = this.pending.shift() ?? 'requestFrame';
      if (event.data.type === 'frame') handlers.onFrame(event.data, command);
      else handlers.onError?.(event.data.message);
    };
    this.worker.onerror = (event) => handlers.onError?.(event.message);
  }

  send(command: SimCommand): void {
    this.pending.push(command.type);
    this.worker.postMessage(command);
  }

  /** Number of `advance` commands sent but not yet answered. */
  get advancesInFlight(): number {
    let count = 0;
    for (const type of this.pending) if (type === 'advance') count++;
    return count;
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.length = 0;
  }
}
