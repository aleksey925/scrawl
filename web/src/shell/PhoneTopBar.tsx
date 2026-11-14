import { useEffect, useState, type JSX, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

import { RenameField } from '../components/RenameField';
import { planMotion } from '../components/screenMotion';
import { cameFrom } from '../historyTrail';
import { IconChevronLeft } from '../icons';
import { isEditPath } from '../paths';
import { layout } from '../theme';

import { AppLogo } from './AppLogo';
import { usePageRenaming } from './fileActionsContext';
import { spaceLabel, useNav } from './NavContext';
import { useShownChrome } from './PageChrome';
import classes from './PhoneTopBar.module.css';
import { useSwipeBack } from './useSwipeBack';

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

export function PhoneTopBar({ end, menu, actionsRef }: PhoneTopBarProps): JSX.Element {
  const { me } = useNav();
  const chrome = useShownChrome();
  const space = spaceLabel(me);
  const atRoot = chrome.title === '';
  const parent = chrome.crumbs[chrome.crumbs.length - 1] ?? { name: space, url: '/' };
  const location = useLocation();
  const editing = isEditPath(location.pathname);
  const { scrolled, showTitle } = useScrolled(chrome.ownTitle);
  const navigate = useNavigate();
  const { renaming, commit } = usePageRenaming();
  const goUp = (): boolean => {
    planMotion(parent.url, 'back');
    if (!cameFrom(parent.url)) {
      return false;
    }
    void navigate(-1);
    return true;
  };
  useSwipeBack(
    editing || atRoot
      ? null
      : () => {
          commit();
          if (!goUp()) {
            void navigate(parent.url);
          }
        },
  );

  if (editing) {
    return (
      <div data-testid="topbar" data-editing="true" className={classes.bar}>
        <div data-testid="topbar-actions" className={classes.editActions} ref={actionsRef} />
        <div className={classes.editEnd}>{end}</div>
      </div>
    );
  }

  return (
    <div
      data-testid="topbar"
      data-scrolled={scrolled ? 'true' : 'false'}
      data-renaming={renaming === undefined ? 'false' : 'true'}
      className={classes.bar}
    >
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
            onClick={(event) => {
              if (goUp()) {
                event.preventDefault();
              }
            }}
            className={classes.up}
            aria-label={`Back to ${parent.name}`}
          >
            <IconChevronLeft size={layout.iconSize} />
            <span className={classes.upName}>{parent.name}</span>
          </Link>
        )}
      </div>

      <div data-testid="topbar-title" data-shown={showTitle && !atRoot ? 'true' : 'false'} className={classes.title}>
        {renaming !== undefined ? (
          <RenameField session={renaming} testId="page-rename" className={classes.field} />
        ) : (
          !atRoot && chrome.title
        )}
      </div>

      <div className={classes.end}>
        {end}
        <div data-testid="topbar-actions" className={classes.actions} ref={actionsRef} />
        <div className={classes.menu}>{menu}</div>
      </div>
    </div>
  );
}
