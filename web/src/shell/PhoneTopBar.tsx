import { useEffect, useState, type JSX, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

import type { Crumb } from '../api/types';
import { prefetchDir } from '../api/useApi';
import { RenameField } from '../components/RenameField';
import { planMotion } from '../components/screenMotion';
import { cameFrom } from '../historyTrail';
import { IconChevronLeft } from '../icons';
import { directoryUrl, isDocPath, isEditPath } from '../paths';
import { usePlatform } from '../platform';
import { layout } from '../theme';

import { AppLogo } from './AppLogo';
import { DraftNameField } from './DraftName';
import { usePageRenaming } from './fileActionsContext';
import { basenameOf, contentPathOf, parentOf } from './naming';
import { spaceLabel, useAccount } from './NavContext';
import { useShownChrome } from './PageChrome';
import classes from './PhoneTopBar.module.css';
import { useSwipeBack } from './useSwipeBack';

function titleGone(): boolean {
  const heading = document.querySelector('[data-screen] h1');
  if (heading === null) {
    return window.scrollY > 0;
  }
  return heading.getBoundingClientRect().bottom <= layout.topbarHeightCompact;
}

interface WayUp extends Crumb {
  dir?: string;
}

function wayUp(pathname: string, crumb: Crumb | undefined, space: string): WayUp {
  if (!isDocPath(pathname)) {
    return crumb ?? { name: space, url: '/' };
  }
  const dir = parentOf(contentPathOf(pathname));
  return { name: dir === '' ? space : basenameOf(dir), url: directoryUrl(dir), dir };
}

function atRootOf(pathname: string, rootTitle: boolean): boolean {
  return isDocPath(pathname) ? contentPathOf(pathname) === '' : pathname === directoryUrl('') || rootTitle;
}

function useScrolled(watchTitle: boolean): { scrolled: boolean; showTitle: boolean } {
  const location = useLocation();
  const [state, setState] = useState({ scrolled: false, showTitle: !watchTitle });

  useEffect(() => {
    const update = (): void => {
      const scrolled = window.scrollY > 0;
      const showTitle = !watchTitle || titleGone();
      setState((prev) => (prev.scrolled === scrolled && prev.showTitle === showTitle ? prev : { scrolled, showTitle }));
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
  const { me } = useAccount();
  const chrome = useShownChrome();
  const space = spaceLabel(me);
  const atRoot = chrome.title === '';
  const location = useLocation();
  const parent = wayUp(location.pathname, chrome.crumbs[chrome.crumbs.length - 1], space);
  const above = parent.dir;
  const { source, prefetch } = usePlatform();
  const editing = isEditPath(location.pathname);
  const { scrolled, showTitle } = useScrolled(chrome.ownTitle);
  const navigate = useNavigate();
  const { renaming, commit } = usePageRenaming();
  const draft = chrome.draft;
  const [naming, setNaming] = useState(false);
  useEffect(() => setNaming(false), [location.pathname]);
  const goUp = (): boolean => {
    planMotion(parent.url, 'back');
    if (!cameFrom(parent.url)) {
      return false;
    }
    void navigate(-1);
    return true;
  };
  useSwipeBack(
    editing || atRootOf(location.pathname, atRoot)
      ? null
      : () => {
          commit();
          if (!goUp()) {
            void navigate(parent.url);
          }
        },
    above === undefined || !prefetch ? undefined : () => prefetchDir(source, above),
  );

  if (editing) {
    const namingDraft = naming && draft !== undefined;
    return (
      <div data-testid="topbar" data-editing="true" data-renaming={namingDraft ? 'true' : 'false'} className={classes.bar}>
        <div data-testid="topbar-actions" className={classes.editActions} ref={actionsRef} />
        {namingDraft ? (
          <div className={classes.editField}>
            <DraftNameField draft={draft} className={classes.field} onDone={() => setNaming(false)} />
          </div>
        ) : draft === undefined ? (
          <span data-testid="topbar-edit-name" className={classes.editName}>
            {chrome.name}
          </span>
        ) : (
          <button
            type="button"
            data-testid="topbar-draft-name"
            className={`${classes.editName} ${classes.draftName}`}
            aria-label={`Name the new note, now ${chrome.name}`}
            onClick={() => setNaming(true)}
          >
            {chrome.name}
          </button>
        )}
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
