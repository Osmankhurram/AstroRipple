/// <reference lib="webworker" />
/** Web Worker entry: keeps propagation and proximity screening off the render loop. */
import { SatEngine } from './engine';
import type { WorkerIn } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

const engine = new SatEngine((m, transfer = []) => self.postMessage(m, transfer));
self.onmessage = (e: MessageEvent<WorkerIn>) => engine.handle(e.data);
