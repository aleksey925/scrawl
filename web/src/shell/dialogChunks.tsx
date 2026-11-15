import { useEffect, useState, type ComponentType, type JSX } from 'react';

import { loadChunk } from '../staleBundle';
import { showToast } from '../toast';

type DialogProps = { onClose: () => void };

const preloads: (() => Promise<unknown>)[] = [];

function chunkDialog<P extends DialogProps>(
  name: string, load: () => Promise<ComponentType<P>>,
): (props: P) => JSX.Element | null {
  let loaded: ComponentType<P> | undefined;
  let pending: Promise<ComponentType<P>> | undefined;
  const fetchDialog = (): Promise<ComponentType<P>> => {
    pending ??= loadChunk(load()).then((component) => {
      loaded = component;
      return component;
    });
    return pending;
  };
  preloads.push(fetchDialog);

  return function ChunkDialog(props: P): JSX.Element | null {
    const [Dialog, setDialog] = useState(() => loaded);
    const { onClose } = props;
    useEffect(() => {
      if (Dialog !== undefined) {
        return undefined;
      }
      let live = true;
      fetchDialog().then(
        (component) => {
          if (live) {
            setDialog(() => component);
          }
        },
        () => {
          if (live) {
            showToast('error', { title: `${name} did not open`, message: 'Its part of the app did not load. Load the page again to open it.' });
            onClose();
          }
        },
      );
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

const idleWaitMs = 300;

function whenIdle(task: () => void): void {
  const later = (): void => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(task);
    } else {
      setTimeout(task, idleWaitMs);
    }
  };
  if (document.readyState === 'complete') {
    later();
  } else {
    window.addEventListener('load', later, { once: true });
  }
}

export function preloadDialogs(): void {
  whenIdle(() => {
    for (const preload of preloads) {
      void preload().catch(() => undefined);
    }
  });
}
