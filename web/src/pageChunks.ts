import { whenIdle } from './idle';
import { loadChunk } from './staleBundle';

export const documentPage = (): Promise<typeof import('./pages/DocumentPage')> => import('./pages/DocumentPage');

export const editPage = (): Promise<typeof import('./pages/EditPage')> => import('./pages/EditPage');

export function preloadPage(page: () => Promise<unknown>): void {
  whenIdle(() => {
    void loadChunk(page()).catch(() => undefined);
  });
}
