import { Button, Code, Modal, Group, Stack, Text, TextInput } from '@mantine/core';
import { modals } from '@mantine/modals';
import {
  createContext, useCallback, useContext, useMemo, useState,
  type FormEvent, type JSX, type ReactNode,
} from 'react';
import { useNavigate } from 'react-router';

import { ApiError, api } from '../api/client';
import type { EntryKind, EntryPathResponse } from '../api/types';
import { errorText } from '../api/useApi';
import { mountBase } from '../mount';
import { directoryUrl, documentUrl, editUrl, isMarkdown, slugPath } from '../paths';
import { layout } from '../theme';
import { showToast } from '../toast';

import { useNav } from './NavContext';
import { useMutationState } from './useMutationState';
import { basenameOf, joinPath, parentOf } from './naming';

// TreeDraft is a row that does not exist yet: the tree shows an input where the
// entry will be, and the name is typed in place. There is no dialog, because a
// dialog asks for the one thing the tree already knows - which folder - and
// then covers the answer while the name is typed.
export interface TreeDraft {
  kind: EntryKind;
  parent: string;
}

export interface FileActions {
  createPage: (folder: string) => void;
  createFolder: (folder: string) => void;
  rename: (path: string, isDir: boolean) => void;
  remove: (path: string, isDir: boolean) => void;
  copyLink: (path: string, isDir: boolean) => void;
  // moveInto is the drop half of dragging rows around the tree. It takes the
  // whole selection, because dragging one of several selected rows moves them
  // all, which is what every file manager does.
  moveInto: (paths: readonly string[], folder: string) => void;
  draft: TreeDraft | undefined;
  // true when the entry was created, so the row can keep the typed name on
  // screen for a second try when it was not
  submitDraft: (name: string) => Promise<boolean>;
  cancelDraft: () => void;
}

const FileActionsContext = createContext<FileActions | undefined>(undefined);

export function useFileActions(): FileActions {
  const actions = useContext(FileActionsContext);
  if (actions === undefined) {
    throw new Error('file actions are only available inside the app shell');
  }
  return actions;
}

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

const inputStyles = { input: { fontSize: layout.inputFontSize } };

export function FileActionsProvider({ children }: { children: ReactNode }): JSX.Element {
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

  const remove = useCallback(
    (path: string, isDir: boolean) => {
      modals.openConfirmModal({
        title: isDir ? 'Delete folder?' : 'Delete page?',
        children: (
          <Text data-testid="modal" data-variant="confirm" size="sm">
            <Code>{path}</Code> will be removed. This cannot be undone from the browser.
          </Text>
        ),
        labels: { confirm: 'Delete', cancel: 'Cancel' },
        confirmProps: { color: 'red', 'data-testid': 'modal-confirm' },
        cancelProps: { 'data-testid': 'modal-cancel' },
        onConfirm: () => {
          void (async () => {
            try {
              reportMutation(await api.deleteEntry(path), 'Deleted');
              if (currentPath === path) {
                await navigate('/');
              }
              refreshNav();
            } catch (error) {
              showToast('error', {
                title: 'Nothing was deleted',
                message: conflictText(error, 'The folder is not empty'),
              });
            }
          })();
        },
      });
    },
    [currentPath, navigate, refreshNav, reportMutation],
  );

  const startDraft = useCallback(
    (kind: EntryKind, parent: string) => {
      // the row is typed into where it will be, so the folder has to be open
      // and a filter hiding it has to go
      setQuery('');
      openFolder(parent);
      setDraft({ kind, parent });
    },
    [openFolder, setQuery],
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
    // .md is what the tree, the search index and /p/ all key on, so a rename
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
            styles={{ input: { ...inputStyles.input, fontFamily: 'var(--mantine-font-family-monospace)' } }}
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

// folderFor is where a new entry lands when the reader did not point at one: the
// folder they are looking at, or the folder holding the note they are reading.
export function folderFor(path: string, isDir: boolean): string {
  return isDir ? path : parentOf(path);
}
