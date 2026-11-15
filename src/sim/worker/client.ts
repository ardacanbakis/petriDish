import type { SimCommand, SimFrame, SimResponse } from './protocol';

export interface SimClientHandlers {
  onFrame: (frame: SimFrame, command: SimCommand['type']) => void;
  onError?: (message: string) => void;
}

interface Pending {
  type: SimCommand['type'];
  /** Called with the frame that answers this particular command, before `onFrame`. */
  onAnswer?: (frame: SimFrame) => void;
}

/**
 * UI-thread handle on the simulation worker.
 *
 * Responses arrive in the order commands were sent, so a simple queue of
 * pending commands is enough to tell which command a frame answers.
 */
export class SimClient {
  private readonly worker: Worker;
  private readonly pending: Pending[] = [];

  constructor(handlers: SimClientHandlers) {
    this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<SimResponse>) => {
      const answered = this.pending.shift();
      if (event.data.type === 'frame') {
        answered?.onAnswer?.(event.data);
        handlers.onFrame(event.data, answered?.type ?? 'requestFrame');
      } else {
        handlers.onError?.(event.data.message);
      }
    };
    this.worker.onerror = (event) => handlers.onError?.(event.message);
  }

  send(command: SimCommand, onAnswer?: (frame: SimFrame) => void): void {
    this.pending.push({ type: command.type, onAnswer });
    this.worker.postMessage(command);
  }

  /** Number of commands of this type sent but not yet answered. */
  inFlight(type: SimCommand['type']): number {
    let count = 0;
    for (const entry of this.pending) if (entry.type === type) count++;
    return count;
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.length = 0;
  }
}
