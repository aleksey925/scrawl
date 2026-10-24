import { useEffect, useState, type JSX, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

import { planMotion } from '../components/screenMotion';
import { IconChevronLeft } from '../icons';
import { isEditPath } from '../paths';
import { layout } from '../theme';

import { AppLogo } from './AppLogo';
import { spaceLabel, useNav } from './NavContext';
import { useShownChrome } from './PageChrome';
import classes from './PhoneTopBar.module.css';
import { useSwipeBack } from './useSwipeBack';

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
  end?: ReactNode;
  menu?: ReactNode;
  actionsRef: (element: HTMLElement | null) => void;
}

// PhoneTopBar is the bar on top of a phone: the way to the folder above, or the
// app and the space on the root, the page's title once its own has scrolled
// away, and the page's menu
export function PhoneTopBar({ end, menu, actionsRef }: PhoneTopBarProps): JSX.Element {
  const { me } = useNav();
  const chrome = useShownChrome();
  const space = spaceLabel(me);
  const atRoot = chrome.title === '';
  const parent = chrome.crumbs[chrome.crumbs.length - 1] ?? { name: space, url: '/' };
  const location = useLocation();
  // the editor's own actions are the whole bar: Cancel at one end, Save at the other
  const editing = isEditPath(location.pathname);
  const { scrolled, showTitle } = useScrolled(chrome.ownTitle);
  const navigate = useNavigate();
  // the router numbers the entries of the history it made; 0 is the page the app
  // was opened on, before which there is nothing of ours to go back to
  const inHistory = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
  useSwipeBack(
    editing || (atRoot && !inHistory)
      ? null
      : () => {
          if (inHistory) {
            void navigate(-1);
            return;
          }
          planMotion(parent.url, 'back');
          void navigate(parent.url);
        },
  );

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
          <span data-testid="topbar-home" className={classes.home}>
            <AppLogo />
            <span className={classes.homeName}>{space}</span>
          </span>
        ) : (
          <Link
            data-testid="topbar-up"
            to={parent.url}
            onClick={() => planMotion(parent.url, 'back')}
            className={classes.up}
            aria-label={`Back to ${parent.name}`}
          >
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
