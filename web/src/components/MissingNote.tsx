import { IconFilePlus, IconFolder, IconSearch } from '../icons';
import { useEffect, type JSX } from 'react';
import { Link, useNavigate } from 'react-router';

import type { MissingDocumentResponse } from '../api/types';
import { directoryUrl, editUrl } from '../paths';
import { usePlatform } from '../platform';
import { basenameOf, pageName, parentOf } from '../shell/naming';
import { chromeOf, usePageChrome } from '../shell/PageChrome';
import { typingInto } from '../shell/shortcuts';
import { SyncBadge } from '../shell/SyncBadge';
import { layout } from '../theme';

import classes from './MissingNote.module.css';
import { Page, PageTitle } from './Page';

export interface MissingNoteProps {
  path: string;
  page: MissingDocumentResponse;
}

// MissingNote is a note that does not exist yet: its name as a faint title and
// the ways on from here. Enter takes the first one, which creates it.
export function MissingNote({ path, page }: MissingNoteProps): JSX.Element {
  const navigate = useNavigate();
  const { search } = usePlatform();
  const name = pageName(basenameOf(path), false);
  const folder = parentOf(path);
  usePageChrome(chromeOf(page.breadcrumbs, name));

  useEffect(() => {
    if (!page.can_create) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' || event.defaultPrevented || typingInto(event.target)) {
        return;
      }
      if (event.target instanceof HTMLElement && event.target.closest('a, button') !== null) {
        return;
      }
      event.preventDefault();
      void navigate(editUrl(path));
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [navigate, page.can_create, path]);

  return (
    <Page data-testid="doc-missing">
      <PageTitle faint testId="doc-missing-title">
        {name}
      </PageTitle>
      <p className={classes.lead}>
        This note does not exist yet.
        {/* a deletion that failed to push leaves the note gone here and
            present on the remote, and this is the screen that says so */}
        <SyncBadge path={path} />
      </p>
      <p className={classes.hint}>{page.can_create ? 'Press Enter to create it, or pick another way:' : 'Where to go from here:'}</p>
      <div className={classes.options}>
        {page.can_create && (
          <Link data-testid="doc-create" to={editUrl(path)} className={classes.option} data-first="true">
            <IconFilePlus size={layout.iconSize} />
            <span>Create {path}</span>
          </Link>
        )}
        <Link data-testid="doc-missing-folder" to={folder === '' ? '/' : directoryUrl(folder)} className={classes.option}>
          <IconFolder size={layout.iconSize} />
          <span>{folder === '' ? 'Open the notes of the space' : `Open the folder ${basenameOf(folder)}`}</span>
        </Link>
        {search && (
          <Link
            data-testid="doc-missing-search"
            to={`/search?q=${encodeURIComponent(name)}`}
            className={classes.option}
          >
            <IconSearch size={layout.iconSize} />
            <span>Search for a similar note</span>
          </Link>
        )}
      </div>
    </Page>
  );
}
