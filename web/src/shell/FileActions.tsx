import { Button, Code, Modal, Group, Stack, Text, TextInput } from '@mantine/core';
import { modals } from '@mantine/modals';
import {
  useCallback, useMemo, useState,
  type FormEvent, type JSX, type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router';

import { api } from '../api/client';
import { ApiError } from '../api/errors';
import type { EntryKind, EntryPathResponse } from '../api/types';
import { errorText } from '../api/useApi';
import { mountBase } from '../mount';
import { copyText } from '../reader/clipboard';
import { directoryUrl, documentUrl, isDirectoryPath, isMarkdown, slugPath } from '../paths';
import { layoutBreakpoints, useBelow } from '../theme';
import { showToast } from '../toast';

import { FileActionsContext, type FileActions, type TreeDraft } from './fileActionsContext';
import { useReaderLayout } from './ReaderLayout';
import { useNav } from './NavContext';
import { NewEntryDialog } from './NewEntryDialog';
import { useMutationState } from './useMutationState';
import { basenameOf, hasOwnExtension, joinPath } from './naming';

function conflictText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status === 409) {
    return fallback;
  }
  return errorText(error);
}

function appUrl(path: string, isDir: boolean): string {
  const base = mountBase().replace(/\/$/, '');
  const route = isDir ? directoryUrl(path) : documentUrl(path);
  return new URL(`${base}${route}`, window.location.origin).href;
}

// draftPath is what a typed name becomes. A title is a note: its slug, by the
// store's rule so a page and the image dropped into it romanize the same word
// the same way, with .md added. A name with an extension of its own is a file
// named as typed: a slug would lowercase Main.java, which java will not compile.
function draftPath(draft: TreeDraft, name: string): string {
  if (draft.kind === 'file' && hasOwnExtension(name) && !isMarkdown(name.trim())) {
    const typed = name
      .split('/')
      .map((part) => part.trim())
      .filter((part) => part !== '')
      .join('/');
    return joinPath(draft.parent, typed);
  }
  const slug = slugPath(name);
  if (slug === '') {
    return '';
  }
  return joinPath(draft.parent, draft.kind === 'file' && !isMarkdown(slug) ? `${slug}.md` : slug);
}

// movedTo is where a path went when it, or a folder above it, moved from one
// path to another, and undefined when the move left it where it was
function movedTo(path: string, from: string, to: string): string | undefined {
  if (path === from) {
    return to;
  }
  return path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : undefined;
}

export function FileActionsProvider({ children }: { children: ReactNode }): JSX.Element {
  // a draft is typed into the tree, so the tree has to be on screen for it
  const { revealNav: revealTree } = useReaderLayout();
  const navigate = useNavigate();
  const { currentPath, refreshNav, openFolder, setQuery } = useNav();
  const onFolder = isDirectoryPath(useLocation().pathname);
  const reportMutation = useMutationState();
  const [renaming, setRenaming] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState<TreeDraft | undefined>(undefined);
  // a phone has no tree to type a name into, so it asks in a dialog instead
  const phone = useBelow(layoutBreakpoints.phone);
  const [naming, setNaming] = useState<TreeDraft | undefined>(undefined);

  const copyLink = useCallback(async (path: string, isDir: boolean): Promise<void> => {
    if (await copyText(appUrl(path, isDir))) {
      showToast('ok', { message: 'Link copied' });
    } else {
      showToast('error', { message: 'Could not copy the link' });
    }
  }, []);

  const confirmRemove = useCallback(
    (path: string, isDir: boolean, withContents: boolean) => {
      modals.openConfirmModal({
        title: withContents ? 'Delete folder and everything in it?' : isDir ? 'Delete folder?' : 'Delete file?',
        children: (
          <Text data-testid="modal" data-variant={withContents ? 'confirm-contents' : 'confirm'} size="sm">
            {withContents ? (
              <>
                <Code>{path}</Code> is not empty. The folder and every file in it will be removed.
              </>
            ) : (
              <>
                <Code>{path}</Code> will be removed.
              </>
            )}{' '}
            This cannot be undone from the browser.
          </Text>
        ),
        labels: { confirm: withContents ? 'Delete everything' : 'Delete', cancel: 'Cancel' },
        confirmProps: { color: 'red', 'data-testid': 'modal-confirm' },
        cancelProps: { 'data-testid': 'modal-cancel' },
        onConfirm: () => {
          void (async () => {
            try {
              reportMutation(await api.deleteEntry(path, withContents), 'Deleted');
              if (currentPath === path || currentPath.startsWith(`${path}/`)) {
                await navigate('/');
              }
              refreshNav();
            } catch (error) {
              // the folder turned out to hold something after all: a file the
              // app does not list, or one that arrived while the dialog was up
              if (isDir && !withContents && error instanceof ApiError && error.status === 409) {
                confirmRemove(path, isDir, true);
                return;
              }
              showToast('error', { title: 'Nothing was deleted', message: errorText(error) });
            }
          })();
        },
      });
    },
    [currentPath, navigate, refreshNav, reportMutation],
  );

  const remove = useCallback(
    (path: string, isDir: boolean) => {
      if (!isDir) {
        confirmRemove(path, isDir, false);
        return;
      }
      void (async () => {
        let holdsEntries = false;
        try {
          holdsEntries = (await api.dir(path)).entries.length > 0;
        } catch {
          // the delete itself answers when the folder could not be listed
        }
        confirmRemove(path, isDir, holdsEntries);
      })();
    },
    [confirmRemove],
  );

  const startDraft = useCallback(
    (kind: EntryKind, parent: string) => {
      if (phone) {
        setNaming({ kind, parent });
        return;
      }
      // the row is typed into where it will be, so the folder has to be open
      // and a filter hiding it has to go
      setQuery('');
      openFolder(parent);
      setDraft({ kind, parent });
      revealTree();
    },
    [openFolder, phone, revealTree, setQuery],
  );

  const cancelDraft = useCallback(() => setDraft(undefined), []);

  // createEntry is the one way a file or a folder is made, from the tree's name
  // field and from a folder list's name row alike
  const createEntry = useCallback(
    async (draft: TreeDraft, name: string): Promise<boolean> => {
      const path = draftPath(draft, name);
      const isFile = draft.kind === 'file';
      if (path === '') {
        showToast('error', { message: `${isFile ? 'A file' : 'A folder'} needs a letter or a digit in its name` });
        return false;
      }
      let res: EntryPathResponse;
      try {
        res = await api.createEntry(path, draft.kind);
      } catch (error) {
        showToast('error', {
          title: 'Nothing was created',
          message: conflictText(error, isFile ? 'That file already exists' : 'That folder already exists'),
        });
        return false;
      }
      refreshNav();
      if (isFile && res.edit_url !== undefined) {
        // straight into the editor, because an empty note is not a thing
        // anybody wanted, it is the first half of writing one
        await navigate(res.edit_url);
        return true;
      }
      if (isFile) {
        reportMutation(res, 'File created');
        await navigate(documentUrl(res.path));
        return true;
      }
      reportMutation(res, 'Folder created');
      openFolder(res.path);
      // onto the new folder, the way a new file opens: what comes next is put
      // into it, and left on the old page the next file landed beside it
      await navigate(directoryUrl(res.path));
      return true;
    },
    [navigate, openFolder, refreshNav, reportMutation],
  );

  const submitDraft = useCallback(
    async (name: string): Promise<boolean> => {
      if (draft === undefined) {
        return false;
      }
      const created = await createEntry(draft, name);
      if (created) {
        setDraft(undefined);
      }
      return created;
    },
    [createEntry, draft],
  );

  const moveInto = useCallback(
    (paths: readonly string[], folder: string) => {
      void (async () => {
        const moved: { from: string; to: string }[] = [];
        let failure: unknown;
        for (const from of paths) {
          try {
            const res = await api.move(from, joinPath(folder, basenameOf(from)));
            moved.push({ from, to: res.path });
          } catch (error) {
            failure = error;
          }
        }
        if (moved.length > 0) {
          refreshNav();
          // a drop the reader cannot see landed nowhere as far as they are
          // concerned, so the folder it went into opens
          openFolder(folder);
          reportMutation(undefined, moved.length === 1 ? 'Moved' : `Moved ${moved.length} items`);
          // the page on screen moved with the rest, or inside a folder that did,
          // and its old address is a 404 the moment the tree refreshes
          const here = moved.map((pair) => movedTo(currentPath, pair.from, pair.to)).find((path) => path !== undefined);
          if (here !== undefined) {
            await navigate(onFolder ? directoryUrl(here) : documentUrl(here));
          }
        }
        if (failure !== undefined) {
          showToast('error', {
            title: moved.length > 0 ? 'Some of it did not move' : 'Nothing was moved',
            message: conflictText(failure, 'Something of that name is already there'),
          });
        }
      })();
    },
    [currentPath, navigate, onFolder, openFolder, refreshNav, reportMutation],
  );

  const actions = useMemo<FileActions>(
    () => ({
      createPage: (folder) => startDraft('file', folder),
      createFolder: (folder) => startDraft('dir', folder),
      rename: (path) => setRenaming(path),
      remove,
      copyLink: (path, isDir) => void copyLink(path, isDir),
      moveInto,
      draft,
      submitDraft,
      cancelDraft,
      createEntry,
    }),
    [cancelDraft, copyLink, createEntry, draft, moveInto, remove, startDraft, submitDraft],
  );

  return (
    <FileActionsContext.Provider value={actions}>
      {children}

      {naming !== undefined && <NewEntryDialog draft={naming} onCreate={createEntry} onClose={() => setNaming(undefined)} />}

      {renaming !== undefined && (
        <RenameDialog
          path={renaming}
          onClose={() => setRenaming(undefined)}
          onRenamed={(res) => {
            const here = movedTo(currentPath, renaming, res.path);
            setRenaming(undefined);
            reportMutation(res, 'Renamed');
            if (here !== undefined) {
              void navigate(onFolder ? directoryUrl(here) : documentUrl(here));
              return;
            }
            refreshNav();
          }}
        />
      )}
    </FileActionsContext.Provider>
  );
}

interface RenameDialogProps {
  path: string;
  onClose: () => void;
  onRenamed: (res: EntryPathResponse) => void;
}

function RenameDialog({ path, onClose, onRenamed }: RenameDialogProps): JSX.Element {
  const [value, setValue] = useState(path);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  function submit(event: FormEvent): void {
    event.preventDefault();
    const typed = value.trim();
    if (typed === '') {
      setError('The new path has to hold a name.');
      return;
    }
    const to = isMarkdown(path) && !hasOwnExtension(typed) ? `${typed}.md` : typed;
    if (to === path) {
      onClose();
      return;
    }
    setBusy(true);
    setError(undefined);
    void (async () => {
      try {
        onRenamed(await api.move(path, to));
      } catch (failure) {
        setBusy(false);
        setError(conflictText(failure, 'The target already exists'));
      }
    })();
  }

  return (
    <Modal data-testid="modal" data-variant="rename" opened onClose={onClose} title="Rename or move" size="md">
      <form onSubmit={submit}>
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Links in other documents are not rewritten, so check them afterwards.
          </Text>
          <TextInput
            data-testid="modal-path-input"
            data-autofocus
            label="New path"
            value={value}
            error={error}
            autoComplete="off"
            spellCheck={false}
            styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
            onChange={(event) => {
              setValue(event.currentTarget.value);
              setError(undefined);
            }}
          />
          <Group justify="flex-end" gap="sm">
            <Button data-testid="modal-cancel" variant="default" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button data-testid="modal-submit" type="submit" loading={busy}>
              Rename
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
