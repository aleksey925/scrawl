import { useEffect, useRef, type RefObject } from 'react';
import { parsePath, useLocation, useNavigate } from 'react-router';

import { usePlatform } from '../platform';
import { showToast } from '../toast';

import { copyText } from './clipboard';
import { anchorClass, copyClass, copyCode, injectControls, pictureKeyed, pictureOf, sectionLink } from './controls';
import { decodeFragment, elementWithId } from './dom';
import { isPlainClick } from './links';

export function useDocumentControls(
  rootRef: RefObject<HTMLDivElement | null>,
  html: string,
  onImage: (image: HTMLImageElement) => void,
): void {
  const navigate = useNavigate();
  const location = useLocation();
  const { internalTarget } = usePlatform();

  const latest = useRef({ navigate, location, onImage, internalTarget });
  useEffect(() => {
    latest.current = { navigate, location, onImage, internalTarget };
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

    // a bare fragment keeps the query on screen, a link that names the note
    // brings its own
    const jump = (id: string, replace: boolean, search?: string): void => {
      elementWithId(root, id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const { navigate: go, location: at } = latest.current;
      void go({ pathname: at.pathname, search: search ?? at.search, hash: `#${id}` }, { replace });
    };

    const copyLink = async (anchor: HTMLElement): Promise<void> => {
      const id = anchor.dataset.headingId ?? '';
      jump(id, true);
      const copied = await copyText(sectionLink(id));
      showToast(copied ? 'ok' : 'error', {
        message: copied ? 'Link copied' : 'Could not copy the link',
      });
    };

    const copyCodeOf = async (button: HTMLElement): Promise<void> => {
      if (!(await copyCode(button, timers))) {
        showToast('error', { message: 'Could not copy the code' });
      }
    };

    const onClick = (event: MouseEvent): void => {
      if (!isPlainClick(event) || !(event.target instanceof Element)) {
        return;
      }
      const target = event.target;

      const button = target.closest(`.${copyClass}`);
      if (button instanceof HTMLElement) {
        event.preventDefault();
        void copyCodeOf(button);
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
        const internal = latest.current.internalTarget(link);
        if (internal === undefined) {
          return;
        }
        event.preventDefault();
        // a link to a heading of this very note is a jump: no note arrives, so
        // nothing else would land on the heading
        const to = parsePath(internal.to);
        if (to.pathname === latest.current.location.pathname && to.hash !== undefined && to.hash.length > 1) {
          jump(decodeFragment(to.hash.slice(1)), false, to.search ?? '');
          return;
        }
        void latest.current.navigate(internal.to);
        return;
      }

      const image = pictureOf(target);
      if (image !== undefined) {
        latest.current.onImage(image);
      }
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      const image = pictureKeyed(event);
      if (image === undefined) {
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
