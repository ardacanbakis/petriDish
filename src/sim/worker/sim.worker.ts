/// <reference lib="webworker" />
import { SimHost } from './host';
import type { SimCommand, SimResponse } from './protocol';

const host = new SimHost();
const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<SimCommand>) => {
  let response: SimResponse;
  try {
    response = host.handle(event.data);
  } catch (error) {
    response = { type: 'error', message: error instanceof Error ? error.message : String(error) };
  }
  if (response.type === 'frame') {
    const buffers: ArrayBuffer[] = [];
    for (const dish of response.dishes) {
      buffers.push(
        dish.field.buffer as ArrayBuffer,
        dish.colony.buffer as ArrayBuffer,
        dish.agar.buffer as ArrayBuffer,
      );
    }
    scope.postMessage(response, buffers);
  } else {
    scope.postMessage(response);
  }
};
