import type { EditorView } from '@codemirror/view';
import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useBlocker, useNavigate } from 'react-router';

import { api, installUnauthorizedHandler } from '../api/client';
import { ApiError, type ApiConflict } from '../api/errors';
import type { DirListing } from '../api/types';
import { errorText } from '../api/useApi';
import { planMotion } from '../components/screenMotion';
import { cameFrom } from '../historyTrail';
import { directoryUrl, documentUrl, editUrl } from '../paths';
import { useAccount } from '../shell/NavContext';
import { basenameOf, freeName, joinPath, noteNameOf } from '../shell/naming';
import { modChord } from '../shell/shortcuts';
import { useMutationState } from '../shell/useMutationState';
import { holdReload } from '../staleBundle';
import { showToast } from '../toast';

import type { ReadingAnchor } from './anchor';
import { captureFromSource } from './cmAnchor';
import { draftOpening } from './constants';
import { confirmDiscard, openConflict, openSessionExpired } from './dialogs';
import { toEditorText, withLineBreak } from './lineBreaks';
import type { DraftControl } from './useDraft';
import type { UploadControl } from './useUploads';

export interface UseEditSessionOptions {
  path: string;
  folder: string;
  drafting: boolean;
  readOnly: boolean;
  formatOnSave: boolean;
  lineBreak: string;
  dirty: boolean;
  exists: boolean;
  contentRef: RefObject<string>;
  revRef: RefObject<string>;
  manualRef: RefObject<string | undefined>;
  savedAsRef: RefObject<string | undefined>;
  setSaved: Dispatch<SetStateAction<string>>;
  setRev: Dispatch<SetStateAction<string>>;
  setSaving: Dispatch<SetStateAction<boolean>>;
  setSavedAs: Dispatch<SetStateAction<string | undefined>>;
  liveView: () => EditorView | undefined;
  bufferText: () => string;
  putIfUnchanged: (sent: string, text: string, cursor?: number) => boolean;
  formatBuffer: () => Promise<string>;
  refreshToc: () => Promise<string | undefined>;
  uploads: UploadControl;
  draftRef: RefObject<DraftControl>;
  rememberReadingPosition: () => ReadingAnchor | undefined;
}

export interface EditSession {
  leaving: boolean;
  cancel: () => void;
  saveAndLeave: () => Promise<void>;
}

interface SaveResult {
  shownStored: boolean;
  savedTo?: string;
}

const dottedTextNames: ReadonlySet<string> = new Set(['go.mod', 'go.sum']);

function conflictCopyPath(path: string, stamp: string): string {
  const name = basenameOf(path);
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dottedTextNames.has(name)) {
    return `${path}.conflict-${stamp}.txt`;
  }
  const ext = name.slice(dot);
  return `${path.slice(0, path.length - ext.length)}.conflict-${stamp}${ext}`;
}

export function useEditSession({
  path,
  folder,
  drafting,
  readOnly,
  formatOnSave,
  lineBreak,
  dirty,
  exists,
  contentRef,
  revRef,
  manualRef,
  savedAsRef,
  setSaved,
  setRev,
  setSaving,
  setSavedAs,
  liveView,
  bufferText,
  putIfUnchanged,
  formatBuffer,
  refreshToc,
  uploads,
  draftRef,
  rememberReadingPosition,
}: UseEditSessionOptions): EditSession {
  const navigate = useNavigate();
  const { refreshMe } = useAccount();
  const reportMutation = useMutationState();

  const [leaving, setLeaving] = useState(false);
  const savingRef = useRef(false);
  const leavingRef = useRef(false);
  const mountedRef = useRef(true);
  const promptedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => installUnauthorizedHandler('screen', () => draftRef.current.flush()), [draftRef]);

  const uploading = uploads.pending > 0;

  const keepDraft = useCallback((): boolean => {
    if (uploading) {
      return false;
    }
    return draftRef.current.flush();
  }, [draftRef, uploading]);

  useEffect(() => {
    if (!dirty) {
      return;
    }
    return holdReload(() => !leavingRef.current);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) {
      return;
    }
    const warn = (event: BeforeUnloadEvent): void => {
      if (leavingRef.current) {
        return;
      }
      const kept = keepDraft();
      if (kept) {
        return;
      }
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, keepDraft]);

  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }) =>
        dirty && !leavingRef.current && currentLocation.pathname !== nextLocation.pathname,
      [dirty],
    ),
  );

  useEffect(() => {
    if (blocker.state !== 'blocked' || promptedRef.current) {
      return;
    }
    const leave = (): void => {
      leavingRef.current = true;
      blocker.proceed();
    };
    const kept = keepDraft();
    if (kept) {
      leave();
      if (!savingRef.current) {
        showToast('ok', { message: 'Changes kept as a draft on this device' });
      }
      return;
    }
    promptedRef.current = true;
    void confirmDiscard(uploading ? 'uploading' : 'unkept').then((discard) => {
      promptedRef.current = false;
      if (discard) {
        draftRef.current.discard();
        leave();
      } else {
        blocker.reset();
      }
    });
  }, [blocker, draftRef, keepDraft, uploading]);

  const markSaved = useCallback((stored: string, nextRev: string, shown: boolean): void => {
    setSaved(stored);
    setRev(nextRev);
    if (shown) {
      draftRef.current.clear();
    }
  }, [draftRef, setRev, setSaved]);

  const saveCopy = useCallback(async (): Promise<void> => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const copyPath = conflictCopyPath(path, stamp);
    const sent = contentRef.current;
    try {
      reportMutation(
        await api.saveFile(copyPath, { content: withLineBreak(sent, lineBreak), rev: '' }),
        'Saved as a copy',
      );
      setSaved(sent);
      draftRef.current.clear();
      leavingRef.current = true;
      await navigate(editUrl(copyPath));
    } catch (error: unknown) {
      showToast('error', { message: errorText(error) });
    }
  }, [contentRef, draftRef, lineBreak, navigate, path, reportMutation, setSaved]);

  const draftTarget = useCallback(async (sent: string): Promise<string | undefined> => {
    const chosen = manualRef.current;
    let listing: DirListing;
    try {
      listing = await api.dir(folder);
    } catch (error) {
      showToast('error', { title: 'Nothing was saved', message: errorText(error) });
      return undefined;
    }
    const taken = new Set(listing.entries.map((row) => row.name.toLowerCase()));
    if (chosen === undefined) {
      return joinPath(folder, freeName(noteNameOf(sent), taken));
    }
    if (taken.has(basenameOf(chosen).toLowerCase())) {
      showToast('error', { title: 'Nothing was saved', message: 'Something of that name is already there' });
      return undefined;
    }
    return chosen;
  }, [folder, manualRef]);

  const save = useCallback(
    async (withRev?: string): Promise<SaveResult> => {
      if (savingRef.current || readOnly) {
        return { shownStored: false };
      }
      savingRef.current = true;
      setSaving(true);
      rememberReadingPosition();
      let sent = bufferText();
      const first = drafting && savedAsRef.current === undefined;
      let dest = savedAsRef.current ?? path;
      try {
        await uploads.wait();
        const tocFailure = await refreshToc();
        sent = bufferText();
        let formatted = false;
        if (formatOnSave) {
          try {
            sent = await formatBuffer();
            formatted = true;
          } catch {
            sent = bufferText();
          }
        }
        draftRef.current.flush();
        if (first) {
          const target = await draftTarget(sent);
          if (target === undefined) {
            return { shownStored: false };
          }
          dest = target;
        }
        const res = await api.saveFile(dest, {
          content: withLineBreak(first && sent === draftOpening ? '' : sent, lineBreak),
          rev: withRev ?? revRef.current,
          formatted,
        });
        const stored = res.content === undefined ? undefined : toEditorText(res.content);
        const shown = stored === undefined ? bufferText() === sent : putIfUnchanged(sent, stored);
        markSaved(stored ?? sent, res.rev, shown);
        if (res.format_failed === true) {
          showToast('warn', {
            title: 'Saved without formatting',
            message: 'Prettier could not format this note, so it is stored as written.',
          });
        }
        if (tocFailure !== undefined) {
          showToast('warn', { title: 'Could not update the contents', message: tocFailure });
        }
        if (first) {
          savedAsRef.current = dest;
          setSavedAs(dest);
          reportMutation(res, `Created "${basenameOf(dest)}"`);
          return { shownStored: shown, savedTo: dest };
        }
        reportMutation(res, 'Saved');
        return { shownStored: shown };
      } catch (error: unknown) {
        if (error instanceof ApiError && (error.status === 412 || error.status === 409)) {
          const current: ApiConflict | undefined =
            error.conflict ?? (await api.file(dest).catch(() => undefined));
          if (current === undefined) {
            showToast('error', { message: errorText(error) });
            return { shownStored: false };
          }
          const theirs = toEditorText(current.content);
          if (theirs === sent) {
            const shown = bufferText() === sent;
            markSaved(sent, current.rev, shown);
            showToast('ok', { message: 'Saved' });
            refreshMe();
            return { shownStored: shown };
          }
          openConflict({
            mine: sent,
            theirs,
            onOverwrite: () => void save(current.rev),
            onCopy: () => void saveCopy(),
          });
          return { shownStored: false };
        }
        if (error instanceof ApiError && error.status === 401) {
          draftRef.current.flush();
          openSessionExpired();
          return { shownStored: false };
        }
        showToast('error', { message: errorText(error) });
        return { shownStored: false };
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [
      bufferText,
      draftRef,
      draftTarget,
      drafting,
      formatBuffer,
      formatOnSave,
      lineBreak,
      markSaved,
      path,
      putIfUnchanged,
      readOnly,
      refreshMe,
      refreshToc,
      rememberReadingPosition,
      reportMutation,
      revRef,
      saveCopy,
      savedAsRef,
      setSavedAs,
      setSaving,
      uploads,
    ],
  );

  const reopenAt = useCallback(
    (target: string): void => {
      const current = liveView();
      const anchor = current === undefined ? undefined : captureFromSource(current, target, revRef.current);
      leavingRef.current = true;
      void navigate(editUrl(target), { replace: true, state: anchor });
    },
    [liveView, navigate, revRef],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!modChord(event, 's')) {
        return;
      }
      event.preventDefault();
      void save().then((res) => {
        if (res.savedTo !== undefined && mountedRef.current) {
          reopenAt(res.savedTo);
        }
      });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [reopenAt, save]);

  const openReader = useCallback((target?: string): void => {
    rememberReadingPosition();
    const reader = documentUrl(target ?? savedAsRef.current ?? path);
    planMotion(reader, 'back');
    void (cameFrom(reader) ? navigate(-1) : navigate(reader, { replace: true }));
  }, [navigate, path, rememberReadingPosition, savedAsRef]);

  const cancel = useCallback((): void => {
    if (!drafting || savedAsRef.current !== undefined) {
      openReader();
      return;
    }
    const step = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    void (step > 0 ? navigate(-1) : navigate(directoryUrl(folder), { replace: true }));
  }, [drafting, folder, navigate, openReader, savedAsRef]);

  const saveAndLeave = useCallback(async (): Promise<void> => {
    const res: SaveResult = dirty || !exists ? await save() : { shownStored: true };
    if (!res.shownStored) {
      return;
    }
    if (mountedRef.current) {
      leavingRef.current = true;
      setLeaving(true);
      openReader(res.savedTo);
    }
  }, [dirty, exists, openReader, save]);

  return { leaving, cancel, saveAndLeave };
}
