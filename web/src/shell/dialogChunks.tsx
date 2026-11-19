import { useEffect, useState, type ComponentType, type JSX } from 'react';

import { whenIdle } from '../idle';
import { loadChunk, loadQuietly, reloadIfFailedQuietly } from '../staleBundle';
import { showToast } from '../toast';

type DialogProps = { onClose: () => void };

const preloads: (() => Promise<unknown>)[] = [];

function chunkDialog<P extends DialogProps>(
  name: string, load: () => Promise<ComponentType<P>>,
): (props: P) => JSX.Element | null {
  let loaded: ComponentType<P> | undefined;
  let pending: Promise<ComponentType<P>> | undefined;
  const fetchDialog = (): Promise<ComponentType<P>> => {
    pending ??= loadChunk(load()).then(
      (component) => {
        loaded = component;
        return component;
      },
      (error: unknown) => {
        pending = undefined;
        throw error;
      },
    );
    return pending;
  };
  const preload = (): Promise<unknown> =>
    load().then((component) => {
      loaded ??= component;
    });
  preloads.push(preload);

  return function ChunkDialog(props: P): JSX.Element | null {
    const [Dialog, setDialog] = useState(() => loaded);
    const { onClose } = props;
    useEffect(() => {
      if (Dialog !== undefined) {
        return undefined;
      }
      let live = true;
      const refuse = (): void => {
        if (live) {
          showToast('error', { title: `${name} did not open`, message: 'Its part of the app did not load. Load the page again to open it.' });
          onClose();
        }
      };
      void reloadIfFailedQuietly(preload).then(async (refused) => {
        if (refused) {
          refuse();
          return;
        }
        const component = await fetchDialog();
        if (live) {
          setDialog(() => component);
        }
      }).catch(refuse);
      return () => {
        live = false;
      };
    }, [Dialog, onClose]);
    return Dialog === undefined ? null : <Dialog {...props} />;
  };
}

export const SearchDialog = chunkDialog('Search', () => import('./SearchDialog').then((module) => module.SearchDialog));

export const MoveDialog = chunkDialog('Move to', () => import('./MoveDialog').then((module) => module.MoveDialog));

export const ResetDialog = chunkDialog(
  'Replace local copy',
  () => import('./ResetDialog').then((module) => module.ResetDialog),
);

export function preloadDialogs(): void {
  whenIdle(() => {
    for (const entry of preloads) {
      loadQuietly(entry);
    }
  });
}
