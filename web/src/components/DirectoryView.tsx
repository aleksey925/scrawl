import { ActionIcon, Button, Menu } from '@mantine/core';
import { useEffect, useState, type JSX } from 'react';

import type { DirListing, EntryKind } from '../api/types';
import { answerKeys, useApi } from '../api/useApi';
import {
  IconChevronDown, IconDots, IconEdit, IconFilePlus, IconFolderOpen, IconFolderPlus, IconLink, IconPlus, IconTable, IconTrash,
} from '../icons';
import { usePlatform } from '../platform';
import { useOptionalFileActions, type FileActions } from '../shell/fileActionsContext';
import { useNav } from '../shell/NavContext';
import { chromeOf, usePageChrome } from '../shell/PageChrome';
import { PageActions } from '../shell/ShellSlots';
import { layout, layoutBreakpoints, useBelow } from '../theme';

import { AsyncContent } from './AsyncContent';
import classes from './DirectoryView.module.css';
import { DirTable } from './DirTable';
import { EmptyState } from './EmptyState';
import { countOf } from './formats';
import { Page, PageTitle } from './Page';
import { PopupMenu } from './PopupMenu';

export interface DirectoryViewProps {
  path: string;
}

export function DirectoryView({ path }: DirectoryViewProps): JSX.Element {
  const { source } = usePlatform();
  const { changes } = useNav();
  const state = useApi((signal) => source.dir(path, { signal }), [source, path, changes], answerKeys.dir(path));

  return (
    <AsyncContent state={state} testId="dir" page>
      {(dir) => <FolderList path={dir.path} dir={dir} />}
    </AsyncContent>
  );
}

// FolderList is a folder's page: its name and the table of what it holds
function FolderList({ path, dir }: { path: string; dir: DirListing }): JSX.Element {
  const { canWrite, me } = useNav();
  const actions = useOptionalFileActions();
  const [draft, setDraft] = useState<EntryKind | undefined>(undefined);
  const phone = useBelow(layoutBreakpoints.phone);
  const space = me?.space.label ?? me?.site_title ?? dir.title;
  usePageChrome(chromeOf(dir.breadcrumbs, path === '' ? '' : dir.title));
  // a name row belongs to the folder it was opened in
  useEffect(() => setDraft(undefined), [path]);

  const writable = canWrite && actions !== undefined;
  // a phone names a new entry in the dialog the file actions open, having no
  // room for a name row
  const startDraft = (kind: EntryKind): void => {
    if (phone && actions !== undefined) {
      (kind === 'file' ? actions.createPage : actions.createFolder)(path);
      return;
    }
    setDraft(kind);
  };
  const submit = async (name: string): Promise<boolean> => {
    if (actions === undefined || draft === undefined) {
      return false;
    }
    const created = await actions.createEntry({ kind: draft, parent: path }, name);
    if (created) {
      setDraft(undefined);
    }
    return created;
  };

  return (
    <Page data-testid="dir" wide>
      {writable && (
        <PageActions>
          <FolderMenu path={path} actions={actions} />
        </PageActions>
      )}
      <PageTitle testId="dir-title">{path === '' ? space : dir.title}</PageTitle>
      <div className={classes.bar}>
        <div className={classes.tab}>
          <IconTable size={layout.iconSizeSmall} />
          Files
        </div>
        <div className={classes.tools}>
          <span data-testid="dir-count" className={classes.count}>
            {countOf(dir.entries.length, 'item')}
          </span>
          {writable && !phone && (
            <PopupMenu position="bottom-end" width={layout.menuWidthNarrow} withinPortal>
              <Menu.Target>
                <Button data-testid="dir-new" size="xs" rightSection={<IconChevronDown size={layout.iconSizeTiny} />}>
                  New
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  data-testid="dir-new-file"
                  leftSection={<IconFilePlus size={layout.iconSizeSmall} />}
                  onClick={() => startDraft('file')}
                >
                  New file
                </Menu.Item>
                <Menu.Item
                  data-testid="dir-new-folder"
                  leftSection={<IconFolderPlus size={layout.iconSizeSmall} />}
                  onClick={() => startDraft('dir')}
                >
                  New folder
                </Menu.Item>
              </Menu.Dropdown>
            </PopupMenu>
          )}
        </div>
      </div>
      {(dir.entries.length > 0 || draft !== undefined) && (
        <DirTable
          path={path}
          entries={dir.entries}
          draft={draft}
          onDraftSubmit={submit}
          onDraftCancel={() => setDraft(undefined)}
        />
      )}
      {draft === undefined && dir.entries.length > 0 && writable && !phone && (
        <button type="button" data-testid="dir-add-row" className={classes.add} onClick={() => startDraft('file')}>
          <IconPlus size={layout.iconSizeSmall} />
          New file
        </button>
      )}
      {draft === undefined && dir.entries.length === 0 && (
        <EmptyState
          testId="dir-empty"
          icon={IconFolderOpen}
          title="This folder is empty"
          actions={
            writable && (
              <>
                <Button
                  data-testid="dir-empty-new-file"
                  leftSection={<IconFilePlus size={layout.iconSizeSmall} />}
                  onClick={() => startDraft('file')}
                >
                  New file
                </Button>
                <Button
                  data-testid="dir-empty-new-folder"
                  variant="default"
                  leftSection={<IconFolderPlus size={layout.iconSizeSmall} />}
                  onClick={() => startDraft('dir')}
                >
                  New folder
                </Button>
              </>
            )
          }
        >
          {canWrite ? 'It holds no notes and no files yet.' : 'There are no files or folders in it.'}
        </EmptyState>
      )}
    </Page>
  );
}

// FolderMenu is the `⋯` of a folder's page: what to make in it, and what to do
// to it
function FolderMenu({ path, actions }: { path: string; actions: FileActions }): JSX.Element {
  return (
    <PopupMenu position="bottom-end" width={layout.menuWidth} withinPortal>
      <Menu.Target>
        <ActionIcon data-testid="folder-menu" variant="subtle" color="gray" size="lg" aria-label="More actions">
          <IconDots size={layout.iconSize} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown data-testid="folder-menu-dropdown">
        <Menu.Item
          data-testid="folder-menu-new-file"
          leftSection={<IconFilePlus size={layout.iconSizeSmall} />}
          onClick={() => actions.createPage(path)}
        >
          New file
        </Menu.Item>
        <Menu.Item
          data-testid="folder-menu-new-folder"
          leftSection={<IconFolderPlus size={layout.iconSizeSmall} />}
          onClick={() => actions.createFolder(path)}
        >
          New folder
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item
          data-testid="folder-menu-copy-link"
          leftSection={<IconLink size={layout.iconSizeSmall} />}
          onClick={() => actions.copyLink(path, true)}
        >
          Copy link
        </Menu.Item>
        {path !== '' && (
          <>
            <Menu.Item
              data-testid="folder-menu-rename"
              leftSection={<IconEdit size={layout.iconSizeSmall} />}
              onClick={() => actions.rename(path)}
            >
              Rename or move
            </Menu.Item>
            <Menu.Item
              data-testid="folder-menu-delete"
              color="red"
              leftSection={<IconTrash size={layout.iconSizeSmall} />}
              onClick={() => actions.remove(path, true)}
            >
              Delete
            </Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </PopupMenu>
  );
}
