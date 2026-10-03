import { useEffect, useRef, type RefObject } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { showToast } from '../toast';

import { copyText } from './clipboard';
import { anchorClass, copiedLabel, copyClass, copyLabel, injectControls } from './controls';
import { decodeFragment, elementWithId } from './dom';
import { internalTarget, isPlainClick } from './links';

const copiedFor = 1500;

export function useDocumentControls(
  rootRef: RefObject<HTMLDivElement | null>,
  html: string,
  onImage: (image: HTMLImageElement) => void,
): void {
  const navigate = useNavigate();
  const location = useLocation();

  const latest = useRef({ navigate, location, onImage });
  useEffect(() => {
    latest.current = { navigate, location, onImage };
  });

  useEffect(() => {
    const root = rootRef.current;
    return root === null ? undefined : injectControls(root);
  }, [rootRef, html]);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) {
      return undefined;
    }

    const timers = new Set<number>();

    const jump = (id: string, replace: boolean): void => {
      elementWithId(root, id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const { navigate: go, location: at } = latest.current;
      void go({ pathname: at.pathname, search: at.search, hash: `#${id}` }, { replace });
    };

    const copyLink = async (anchor: HTMLElement): Promise<void> => {
      const id = anchor.dataset.headingId ?? '';
      jump(id, true);
      const copied = await copyText(`${window.location.origin}${window.location.pathname}#${id}`);
      showToast(copied ? 'ok' : 'error', {
        message: copied ? 'Link copied' : 'Could not copy the link',
      });
    };

    const copyCode = async (button: HTMLElement): Promise<void> => {
      const code = button.closest('.code-block')?.querySelector('pre');
      if (!(await copyText(code?.textContent ?? ''))) {
        showToast('error', { message: 'Could not copy the code' });
        return;
      }
      button.dataset.done = 'true';
      button.textContent = copiedLabel;
      const timer = window.setTimeout(() => {
        button.dataset.done = 'false';
        button.textContent = copyLabel;
        timers.delete(timer);
      }, copiedFor);
      timers.add(timer);
    };

    const onClick = (event: MouseEvent): void => {
      if (!isPlainClick(event) || !(event.target instanceof Element)) {
        return;
      }
      const target = event.target;

      const button = target.closest(`.${copyClass}`);
      if (button instanceof HTMLElement) {
        event.preventDefault();
        void copyCode(button);
        return;
      }

      const anchor = target.closest(`.${anchorClass}`);
      if (anchor instanceof HTMLElement) {
        event.preventDefault();
        void copyLink(anchor);
        return;
      }

      const link = target.closest('a');
      if (link instanceof HTMLAnchorElement) {
        const href = link.getAttribute('href') ?? '';
        if (href.startsWith('#')) {
          event.preventDefault();
          jump(decodeFragment(href.slice(1)), false);
          return;
        }
        const internal = internalTarget(link);
        if (internal !== undefined) {
          event.preventDefault();
          void latest.current.navigate(internal.to);
        }
        return;
      }

      const image = target.closest('img');
      if (image instanceof HTMLImageElement && image.closest('a') === null) {
        latest.current.onImage(image);
      }
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      const image = event.target;
      if (!(image instanceof HTMLImageElement) || image.closest('a') !== null) {
        return;
      }
      event.preventDefault();
      latest.current.onImage(image);
    };

    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKeyDown);

    return () => {
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', onKeyDown);
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [rootRef, html]);
}
