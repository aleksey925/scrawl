import { IconChevronLeft } from '../icons';
import { useEffect, useState, type JSX, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';

import { layout } from '../theme';

import { useNav } from './NavContext';
import { useShownChrome } from './PageChrome';
import classes from './PhoneTopBar.module.css';

// titleGone says whether the page's own title has scrolled under the bar. The
// title is the first heading of the page, a note's leading one included.
function titleGone(): boolean {
  const heading = document.querySelector('.mantine-AppShell-main h1');
  if (heading === null) {
    return window.scrollY > 0;
  }
  return heading.getBoundingClientRect().bottom <= layout.topbarHeightCompact;
}

function useScrolled(watchTitle: boolean): { scrolled: boolean; showTitle: boolean } {
  const location = useLocation();
  const [state, setState] = useState({ scrolled: false, showTitle: !watchTitle });

  useEffect(() => {
    const update = (): void => {
      setState({ scrolled: window.scrollY > 0, showTitle: !watchTitle || titleGone() });
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, [watchTitle, location.key]);

  return state;
}

export interface PhoneTopBarProps {
  // home stands at the left on the root, where there is no folder to go back to
  home?: ReactNode;
  end?: ReactNode;
  menu?: ReactNode;
  actionsRef: (element: HTMLElement | null) => void;
}

// PhoneTopBar is the bar on top of a phone: the way to the folder above, the
// page's title once its own has scrolled away, and the page's menu
export function PhoneTopBar({ home, end, menu, actionsRef }: PhoneTopBarProps): JSX.Element {
  const { me } = useNav();
  const chrome = useShownChrome();
  const space = me?.space.label ?? me?.site_title ?? 'Notes';
  const atRoot = chrome.title === '';
  const parent = chrome.crumbs[chrome.crumbs.length - 1] ?? { name: space, url: '/' };
  const { scrolled, showTitle } = useScrolled(chrome.ownTitle);
  const location = useLocation();
  // the editor's own actions are the whole bar: Cancel at one end, Save at the other
  const editing = location.pathname.startsWith('/edit/');

  if (editing) {
    return (
      <div data-testid="topbar" data-editing="true" className={classes.bar}>
        <div data-testid="topbar-actions" className={classes.editActions} ref={actionsRef} />
      </div>
    );
  }

  return (
    <div data-testid="topbar" data-scrolled={scrolled ? 'true' : 'false'} className={classes.bar}>
      <div className={classes.start}>
        {atRoot ? (
          (home ?? <span className={classes.home}>{space}</span>)
        ) : (
          <Link data-testid="topbar-up" to={parent.url} className={classes.up} aria-label={`Back to ${parent.name}`}>
            <IconChevronLeft size={layout.iconSize} />
            <span className={classes.upName}>{parent.name}</span>
          </Link>
        )}
      </div>

      <div data-testid="topbar-title" data-shown={showTitle && !atRoot ? 'true' : 'false'} className={classes.title}>
        {atRoot ? '' : chrome.title}
      </div>

      <div className={classes.end}>
        {end}
        <div data-testid="topbar-actions" className={classes.actions} ref={actionsRef} />
        {menu}
      </div>
    </div>
  );
}
