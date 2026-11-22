import { Button, Menu } from '@mantine/core';
import { useEffect, useState, type JSX } from 'react';

import type { DirListing } from '../api/types';
import { answerKeys, dirOf, useApi } from '../api/useApi';
import { IconChevronDown, IconFolderOpen, IconFolderPlus } from '../icons';
import { usePlatform } from '../platform';
import { useOptionalFileActions } from '../shell/fileActionsContext';
import { spaceLabel, useAccount, useTree } from '../shell/NavContext';
import { chromeOf, usePageChrome } from '../shell/PageChrome';
import { layout, layoutBreakpoints, useBelow } from '../theme';

import { AsyncContent } from './AsyncContent';
import classes from './DirectoryView.module.css';
import { DirTable } from './DirTable';
import { EmptyState } from './EmptyState';
import { Page, PageTitle } from './Page';
import { NewEntryMenu, usePointerMenu } from './pointerMenu';
import { FieldMenuItem, PopupMenu } from './PopupMenu';

export interface DirectoryViewProps {
  path: string;
}

export function DirectoryView({ path }: DirectoryViewProps): JSX.Element {
  const { source } = usePlatform();
  const { changes } = useTree();
  const state = useApi((signal) => dirOf(source, path, signal), [source, path, changes], answerKeys.dir(path));

  return (
    <AsyncContent state={state} testId="dir" page>
      {(dir) => <FolderList path={dir.path} dir={dir} />}
    </AsyncContent>
  );
}

function FolderList({ path, dir }: { path: string; dir: DirListing }): JSX.Element {
  const { canWrite, me } = useAccount();
  const actions = useOptionalFileActions();
  const [adding, setAdding] = useState(false);
  const contextMenu = usePointerMenu<string>();
  const phone = useBelow(layoutBreakpoints.phone);
  const space = spaceLabel(me);
  usePageChrome(chromeOf(dir.breadcrumbs, path === '' ? '' : dir.title, true));
  useEffect(() => setAdding(false), [path]);

  const writable = canWrite && actions !== undefined;
  const drafting = phone ? actions?.draft?.parent === path : adding;
  const newNote = (): void => actions?.newNote(path);
  const newFolder = (): void => {
    if (phone) {
      actions?.newFolder(path);
      return;
    }
    setAdding(true);
  };
  const cancel = (): void => {
    if (phone) {
      actions?.cancelDraft();
      return;
    }
    setAdding(false);
  };
  const submit = async (name: string): Promise<boolean> => {
    if (actions === undefined) {
      return false;
    }
    if (phone) {
      return actions.submitDraft(name);
    }
    const created = await actions.createFolder(path, name);
    if (created) {
      setAdding(false);
    }
    return created;
  };

  return (
    <Page
      data-testid="dir"
      variant="list"
      data-fill
      className={classes.page}
      onContextMenu={writable && !phone ? (event) => contextMenu.onFreeSpace(event, path) : undefined}
    >
      <NewEntryMenu
        menu={contextMenu}
        testId="dir-context-menu"
        onCreate={(kind) => (kind === 'note' ? newNote() : newFolder())}
      />
      {!(phone && path === '') && (
        <div className={classes.head}>
          <PageTitle testId="dir-title">{path === '' ? space : dir.title}</PageTitle>
          {writable && !phone && <NewButton onNote={newNote} onFolder={newFolder} />}
        </div>
      )}
      {(dir.entries.length > 0 || drafting || !phone) && (
        <DirTable path={path} entries={dir.entries} drafting={drafting} onDraftSubmit={submit} onDraftCancel={cancel} />
      )}
      {!drafting && dir.entries.length === 0 && (
        <div className={classes.empty}>
          <EmptyState
            testId="dir-empty"
            icon={IconFolderOpen}
            title="This folder is empty"
            actions={
              writable && (
                <>
                  <Button data-testid="dir-empty-new-note" onClick={newNote}>
                    New note
                  </Button>
                  <Button data-testid="dir-empty-new-folder" variant="default" onClick={newFolder}>
                    New folder
                  </Button>
                </>
              )
            }
          >
            {canWrite ? 'It holds no notes and no files yet.' : 'There are no files or folders in it.'}
          </EmptyState>
        </div>
      )}
    </Page>
  );
}

function NewButton({ onNote, onFolder }: { onNote: () => void; onFolder: () => void }): JSX.Element {
  return (
    <Button.Group className={classes.new}>
      <Button data-testid="dir-new" size="md" title="New note (N)" onClick={onNote}>
        New
      </Button>
      <PopupMenu position="bottom-end" offset={4} withinPortal>
        <Menu.Target>
          <Button data-testid="dir-new-more" size="md" className={classes.more} aria-label="More to create">
            <IconChevronDown size={layout.iconSizeSmall} />
          </Button>
        </Menu.Target>
        <Menu.Dropdown data-testid="dir-new-menu">
          <FieldMenuItem
            data-testid="dir-new-folder"
            leftSection={<IconFolderPlus size={layout.iconSizeSmall} />}
            onClick={onFolder}
          >
            New folder
          </FieldMenuItem>
        </Menu.Dropdown>
      </PopupMenu>
    </Button.Group>
  );
}
