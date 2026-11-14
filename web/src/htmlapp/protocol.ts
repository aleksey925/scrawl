export const htmlappCache = 'scrawl-htmlapp';

export const ownPrefix = '/__scrawl/';

export const workerScript = `${ownPrefix}sw.js`;

export const enterMessage = 'scrawl-htmlapp';

export type WorkerMessage = { type: 'refresh'; parent: string } | { type: 'off' };
