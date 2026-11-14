export const htmlappCache = 'scrawl-htmlapp';

export const workerScript = '/__scrawl/sw.js';

export type WorkerMessage = { type: 'refresh'; parent: string } | { type: 'off' };
