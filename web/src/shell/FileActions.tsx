import { Button, Code, Modal, Group, Stack, Text, TextInput } from '@mantine/core';
import { modals } from '@mantine/modals';
import {
  useCallback, useMemo, useState,
  type FormEvent, type JSX, type ReactNode,
} from 'react';
import { useNavigate } from 'react-router';

import { api } from '../api/client';
import { ApiError } from '../api/errors';
import type { EntryKind, EntryPathResponse } from '../api/types';
import { errorText } from '../api/useApi';
import { mountBase } from '../mount';
import { directoryUrl, documentUrl, editUrl, isMarkdown, slugPath } from '../paths';
import { showToast } from '../toast';

import { FileActionsContext, type FileActions, type TreeDraft } from './fileActionsContext';
import { useReaderLayout } from './ReaderLayout';
import { useNav } from './NavContext';
import { useMutationState } from './useMutationState';
import { basenameOf, joinPath } from './naming';

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

// draftPath is what a typed name becomes. The slug rule is the store's, so a
// page and the image dropped into it romanize the same word the same way, and
// .md is added only when the name does not carry it already.
function draftPath(draft: TreeDraft, name: string): string {
  const slug = slugPath(name);
  if (slug === '') {
    return '';
  }
  return joinPath(draft.parent, draft.kind === 'file' && !isMarkdown(slug) ? `${slug}.md` : slug);
}

export function FileActionsProvider({ children }: { children: ReactNode }): JSX.Element {
  // a draft is typed into the tree, so the tree has to be on screen for it
  const { revealNav: revealTree } = useReaderLayout();
  const navigate = useNavigate();
  const { currentPath, refreshNav, openFolder, setQuery } = useNav();
  const reportMutation = useMutationState();
  const [renaming, setRenaming] = useState<{ path: string; isDir: boolean } | undefined>(undefined);
  const [draft, setDraft] = useState<TreeDraft | undefined>(undefined);

  const copyLink = useCallback(async (path: string, isDir: boolean): Promise<void> => {
    try {
      await navigator.clipboard.writeText(appUrl(path, isDir));
      showToast('ok', { message: 'Link copied' });
    } catch {
      showToast('error', { message: 'Could not copy the link' });
    }
  }, []);

  const confirmRemove = useCallback(
    (path: string, isDir: boolean, withContents: boolean) => {
      modals.openConfirmModal({
        title: withContents ? 'Delete folder and everything in it?' : isDir ? 'Delete folder?' : 'Delete page?',
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
          const listing = await api.dir(path);
          // a folder shown as a document is one that holds an index note
          holdsEntries = listing.kind === 'document' || listing.entries.length > 0;
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
      // the row is typed into where it will be, so the folder has to be open
      // and a filter hiding it has to go
      setQuery('');
      openFolder(parent);
      setDraft({ kind, parent });
      revealTree();
    },
    [openFolder, revealTree, setQuery],
  );

  const cancelDraft = useCallback(() => setDraft(undefined), []);

  const submitDraft = useCallback(
    async (name: string): Promise<boolean> => {
      if (draft === undefined) {
        return false;
      }
      const path = draftPath(draft, name);
      const page = draft.kind === 'file';
      if (path === '') {
        showToast('error', { message: `${page ? 'A file' : 'A folder'} needs a letter or a digit in its name` });
        return false;
      }
      let res: EntryPathResponse;
      try {
        res = await api.createEntry(path, draft.kind);
      } catch (error) {
        showToast('error', {
          title: 'Nothing was created',
          message: conflictText(error, page ? 'That file already exists' : 'That folder already exists'),
        });
        return false;
      }
      setDraft(undefined);
      refreshNav();
      if (page) {
        // straight into the editor, because an empty note is not a thing
        // anybody wanted, it is the first half of writing one
        await navigate(editUrl(res.path));
        return true;
      }
      reportMutation(res, 'Folder created');
      openFolder(res.path);
      // onto the new folder, the way a new file opens: what comes next is put
      // into it, and left on the old page the next file landed beside it
      await navigate(directoryUrl(res.path));
      return true;
    },
    [draft, navigate, openFolder, refreshNav, reportMutation],
  );

  const moveInto = useCallback(
    (paths: readonly string[], folder: string) => {
      void (async () => {
        const moved: string[] = [];
        let failure: unknown;
        for (const path of paths) {
          try {
            const res = await api.move(path, joinPath(folder, basenameOf(path)));
            moved.push(res.path);
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
          // the page on screen moved with the rest, and its old address is a
          // 404 the moment the tree refreshes
          const here = moved.find((path) => path.endsWith(`/${basenameOf(currentPath)}`));
          if (here !== undefined && paths.some((path) => path === currentPath)) {
            await navigate(isMarkdown(here) ? documentUrl(here) : directoryUrl(here));
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
    [currentPath, navigate, openFolder, refreshNav, reportMutation],
  );

  const actions = useMemo<FileActions>(
    () => ({
      createPage: (folder) => startDraft('file', folder),
      createFolder: (folder) => startDraft('dir', folder),
      rename: (path, isDir) => setRenaming({ path, isDir }),
      remove,
      copyLink: (path, isDir) => void copyLink(path, isDir),
      moveInto,
      draft,
      submitDraft,
      cancelDraft,
    }),
    [cancelDraft, copyLink, draft, moveInto, remove, startDraft, submitDraft],
  );

  return (
    <FileActionsContext.Provider value={actions}>
      {children}

      {renaming !== undefined && (
        <RenameDialog
          path={renaming.path}
          onClose={() => setRenaming(undefined)}
          onRenamed={(res) => {
            const was = renaming;
            setRenaming(undefined);
            reportMutation(res, 'Renamed');
            if (currentPath === was.path) {
              void navigate(was.isDir ? directoryUrl(res.path) : documentUrl(res.path));
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
    // .md is what the tree, the search index and the page route all key on, so a rename
    // that drops it leaves the page whole on disk and gone from the app
    const to = isMarkdown(path) && !isMarkdown(typed) ? `${typed}.md` : typed;
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
