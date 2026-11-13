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
    scope.postMessage(response, [
      response.field.buffer,
      response.colony.buffer,
      response.agar.buffer,
    ]);
  } else scope.postMessage(response);
};
