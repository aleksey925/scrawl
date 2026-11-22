import { whenIdle } from './idle';
import { loadQuietly } from './staleBundle';

export const documentPage = (): Promise<typeof import('./pages/NotePage')> => import('./pages/NotePage');

export const editPage = (): Promise<typeof import('./pages/EditPage')> => import('./pages/EditPage');

export function preloadPage(page: () => Promise<unknown>): void {
  whenIdle(() => loadQuietly(page));
}
