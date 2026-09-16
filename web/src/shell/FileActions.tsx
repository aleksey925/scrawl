import { Button, Code, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { modals } from '@mantine/modals';
import {
  createContext, useCallback, useContext, useMemo, useState,
  type FormEvent, type JSX, type ReactNode,
} from 'react';
import { useNavigate } from 'react-router';

import { ApiError, api } from '../api/client';
import type { EntryKind, EntryPathResponse, NavNode } from '../api/types';
import { errorText } from '../api/useApi';
import { mountBase } from '../mount';
import { directoryUrl, documentUrl, editUrl, isMarkdown, slugPath } from '../paths';
import { layout } from '../theme';
import { showMutation, showToast } from '../toast';

import { FolderPicker, foldersOf } from './FolderPicker';
import { useNav } from './NavContext';
import { joinPath } from './naming';

export interface FileActions {
  createPage: (folder: string) => void;
  createFolder: (folder: string) => void;
  rename: (path: string, isDir: boolean) => void;
  remove: (path: string, isDir: boolean) => void;
  copyLink: (path: string, isDir: boolean) => void;
}

const FileActionsContext = createContext<FileActions | undefined>(undefined);

export function useFileActions(): FileActions {
  const actions = useContext(FileActionsContext);
  if (actions === undefined) {
    throw new Error('file actions are only available inside the app shell');
  }
  return actions;
}

type Dialog =
  | { kind: 'none' }
  | { kind: 'create'; entry: EntryKind; folder: string }
  | { kind: 'rename'; path: string; isDir: boolean };

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

const inputStyles = { input: { fontSize: layout.inputFontSize } };

export function FileActionsProvider({ children }: { children: ReactNode }): JSX.Element {
  const navigate = useNavigate();
  const { tree, currentPath, refresh } = useNav();
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' });

  const folders = useMemo(() => foldersOf(tree), [tree]);
  const close = useCallback(() => setDialog({ kind: 'none' }), []);

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
              showMutation(await api.deleteEntry(path), 'Deleted');
              if (currentPath === path || currentPath === `${path}/`) {
                await navigate('/');
              }
              refresh();
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
    [currentPath, navigate, refresh],
  );

  const actions = useMemo<FileActions>(
    () => ({
      createPage: (folder) => setDialog({ kind: 'create', entry: 'file', folder }),
      createFolder: (folder) => setDialog({ kind: 'create', entry: 'dir', folder }),
      rename: (path, isDir) => setDialog({ kind: 'rename', path, isDir }),
      remove,
      copyLink: (path, isDir) => void copyLink(path, isDir),
    }),
    [remove, copyLink],
  );

  return (
    <FileActionsContext.Provider value={actions}>
      {children}

      {dialog.kind === 'create' && (
        <CreateDialog
          entry={dialog.entry}
          startIn={dialog.folder}
          folders={folders}
          onClose={close}
          onCreated={(res) => {
            close();
            if (dialog.entry === 'file') {
              void navigate(editUrl(res.path));
              return;
            }
            showMutation(res, 'Folder created');
            refresh();
          }}
        />
      )}

      {dialog.kind === 'rename' && (
        <RenameDialog
          path={dialog.path}
          onClose={close}
          onRenamed={(res) => {
            close();
            showMutation(res, 'Renamed');
            if (currentPath === dialog.path) {
              void navigate(dialog.isDir ? directoryUrl(res.path) : documentUrl(res.path));
              return;
            }
            refresh();
          }}
        />
      )}
    </FileActionsContext.Provider>
  );
}

interface CreateDialogProps {
  entry: EntryKind;
  startIn: string;
  folders: readonly NavNode[];
  onClose: () => void;
  onCreated: (res: EntryPathResponse) => void;
}

function CreateDialog({ entry, startIn, folders, onClose, onCreated }: CreateDialogProps): JSX.Element {
  const page = entry === 'file';
  const [name, setName] = useState('');
  const [folder, setFolder] = useState(startIn);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const slug = slugPath(name);
  const preview = slug === '' ? (folder === '' ? '/' : folder) : joinPath(folder, page ? `${slug}.md` : slug);

  function submit(event: FormEvent): void {
    event.preventDefault();
    // closing first and complaining afterwards throws away both the typed name
    // and the folder that was picked to put it in
    if (slug === '') {
      setError(`${page ? 'Page name' : 'Folder name'} has to hold a letter or a digit.`);
      return;
    }
    setBusy(true);
    setError(undefined);
    void (async () => {
      try {
        onCreated(await api.createEntry(preview, entry));
      } catch (failure) {
        setBusy(false);
        setError(conflictText(failure, page ? 'That page already exists' : 'That folder already exists'));
      }
    })();
  }

  return (
    <Modal
      data-testid="modal"
      data-variant="create"
      data-entry={entry}
      opened
      onClose={onClose}
      title={page ? 'New page' : 'New folder'}
      size="md"
    >
      <form onSubmit={submit}>
        <Stack gap="md">
          <TextInput
            data-testid="modal-name-input"
            data-autofocus
            label={page ? 'Page name' : 'Folder name'}
            placeholder={page ? 'Replication' : 'databases'}
            description="Use / in the name to nest it deeper."
            value={name}
            error={error}
            autoComplete="off"
            spellCheck={false}
            styles={inputStyles}
            onChange={(event) => {
              setName(event.currentTarget.value);
              setError(undefined);
            }}
          />

          <Stack gap={4}>
            <Text size="sm" fw={500}>
              Location
            </Text>
            <FolderPicker folders={folders} value={folder} onChange={setFolder} />
          </Stack>

          <Text size="sm" c="dimmed" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            Creates <Code data-testid="modal-path-preview">{preview}</Code>
          </Text>

          <Group justify="flex-end" gap="sm">
            <Button data-testid="modal-cancel" variant="default" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button data-testid="modal-submit" type="submit" loading={busy}>
              Create
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
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
