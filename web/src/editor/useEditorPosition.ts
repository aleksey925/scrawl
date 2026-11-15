import type { EditorView } from '@codemirror/view';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useLocation } from 'react-router';

import { holdPosition, interactionEvents } from '../reader/position';

import {
  captureFromPane,
  isReadingAnchor,
  paneTopForAnchor,
  rememberAnchor,
  recallAnchor,
  type ReadingAnchor,
} from './anchor';
import { captureFromSource, holdAnchorAtTop } from './cmAnchor';
import { createPaneSync } from './paneSync';
import type { LayoutMode } from './useLayoutMode';

export interface UseEditorPositionOptions {
  path: string;
  drafting: boolean;
  view: EditorView | undefined;
  liveView: () => EditorView | undefined;
  revRef: RefObject<string>;
  mode: LayoutMode;
  previewHtml: string;
  choose: (next: LayoutMode) => void;
}

export interface EditorPosition {
  previewRef: RefObject<HTMLDivElement | null>;
  rememberReadingPosition: () => ReadingAnchor | undefined;
  chooseMode: (next: LayoutMode) => void;
}

export function useEditorPosition({
  path,
  drafting,
  view,
  liveView,
  revRef,
  mode,
  previewHtml,
  choose,
}: UseEditorPositionOptions): EditorPosition {
  const location = useLocation();
  const arrivedWith = useRef(location.state);
  const previewRef = useRef<HTMLDivElement>(null);
  const leaderRef = useRef<'source' | 'preview' | undefined>(undefined);
  const leftForChangesRef = useRef<ReadingAnchor | undefined>(undefined);

  const [openedAt, setOpenedAt] = useState<ReadingAnchor | undefined>(undefined);

  const previewPlaced = useRef(false);
  const readerMoved = useRef(false);

  useEffect(() => {
    previewPlaced.current = false;
    readerMoved.current = false;
    if (drafting) {
      return;
    }
    const carried = arrivedWith.current;
    const anchor =
      isReadingAnchor(carried) && carried.path === path ? carried : recallAnchor('edit', path);
    if (anchor !== undefined) {
      setOpenedAt(anchor);
    }
  }, [drafting, path]);

  useEffect(() => {
    if (view === undefined || openedAt === undefined) {
      return;
    }
    return holdAnchorAtTop(view, openedAt);
  }, [view, openedAt]);

  useEffect(() => {
    const targets = [view?.dom, previewRef.current].filter((el): el is HTMLElement => el != null);
    const moved = (): void => {
      readerMoved.current = true;
    };
    for (const node of targets) {
      for (const name of interactionEvents) {
        node.addEventListener(name, moved, { passive: true, capture: true });
      }
    }
    return () => {
      for (const node of targets) {
        for (const name of interactionEvents) {
          node.removeEventListener(name, moved, { capture: true });
        }
      }
    };
  }, [view, mode]);

  const panes = useMemo(createPaneSync, []);

  useEffect(() => {
    const pane = previewRef.current;
    if (pane === null || openedAt === undefined || previewPlaced.current || previewHtml === '') {
      return;
    }
    previewPlaced.current = true;
    return holdPosition(() => {
      const source = liveView();
      const top = mode === 'split' && source !== undefined
        ? panes.paneTop(source, pane)
        : paneTopForAnchor(pane, openedAt);
      if (top !== undefined) {
        pane.scrollTop = top;
      }
    }, pane);
  }, [openedAt, previewHtml, mode, liveView, panes]);

  const captureReadingPosition = useCallback((): ReadingAnchor | undefined => {
    const source = liveView();
    const pane = previewRef.current;
    if (openedAt?.path === path && !readerMoved.current) {
      return { ...openedAt, rev: revRef.current };
    }
    if (pane !== null && (source === undefined || leaderRef.current === 'preview')) {
      return captureFromPane(pane, path, revRef.current);
    }
    if (source !== undefined) {
      return captureFromSource(source, path, revRef.current);
    }
    const left = leftForChangesRef.current;
    return left?.path === path ? { ...left, rev: revRef.current } : undefined;
  }, [path, liveView, openedAt, revRef]);

  const rememberReadingPosition = useCallback((): ReadingAnchor | undefined => {
    const anchor = captureReadingPosition();
    if (anchor !== undefined) {
      rememberAnchor('view', anchor);
    }
    return anchor;
  }, [captureReadingPosition]);

  const chooseMode = useCallback(
    (next: LayoutMode): void => {
      if (next === 'changes' && mode !== 'changes') {
        leftForChangesRef.current = captureReadingPosition();
      }
      choose(next);
    },
    [captureReadingPosition, choose, mode],
  );

  useEffect(() => {
    const pane = previewRef.current;
    if (view === undefined || mode !== 'split' || pane === null) {
      return;
    }
    const scroller = view.scrollDOM;
    const syncFromSource = (): void => {
      if (leaderRef.current === 'source') {
        pane.scrollTop = panes.paneTop(view, pane);
      }
    };
    const syncFromPreview = (): void => {
      if (leaderRef.current === 'preview') {
        scroller.scrollTop = panes.sourceTop(view, pane);
      }
    };
    const takeSource = (): void => {
      leaderRef.current = 'source';
    };
    const takePreview = (): void => {
      leaderRef.current = 'preview';
    };

    scroller.addEventListener('scroll', syncFromSource, { passive: true });
    pane.addEventListener('scroll', syncFromPreview, { passive: true });
    for (const name of interactionEvents) {
      scroller.addEventListener(name, takeSource, { passive: true, capture: true });
      pane.addEventListener(name, takePreview, { passive: true, capture: true });
    }
    return () => {
      scroller.removeEventListener('scroll', syncFromSource);
      pane.removeEventListener('scroll', syncFromPreview);
      for (const name of interactionEvents) {
        scroller.removeEventListener(name, takeSource, { capture: true });
        pane.removeEventListener(name, takePreview, { capture: true });
      }
    };
  }, [view, mode, panes, previewHtml]);

  return { previewRef, rememberReadingPosition, chooseMode };
}
