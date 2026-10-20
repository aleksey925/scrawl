import { useCallback, useEffect, useRef, type JSX, type RefObject } from 'react';

import type { Heading } from '../api/types';
import { imagesOf } from '../reader/dom';
import { FindBar } from '../reader/FindBar';
import { useFindControl } from '../reader/findControl';
import { MiniOutline } from '../reader/MiniOutline';
import { ReaderToc } from '../reader/ReaderToc';
import { useDocumentControls } from '../reader/useDocumentControls';
import { useFindOnPage } from '../reader/useFindOnPage';
import { useFragment } from '../reader/useFragment';
import { useKatex } from '../reader/useKatex';
import { useMermaid } from '../reader/useMermaid';
import { useOutline } from '../reader/useOutline';
import { openViewer } from '../reader/viewer';
import { PageToc } from '../shell/ShellSlots';
import { appShortcut } from '../shell/shortcuts';
import { layoutBreakpoints, useAtLeast } from '../theme';

import classes from './DocumentHtml.module.css';

import '../reader/markdown.css';

export interface DocumentHtmlProps {
  html: string;
  // with the headings given, the outline fills the shell's toc slot with the
  // scrollspy one: only this component holds the elements it follows
  toc?: Heading[];
  // true while the reading anchor is placing this arrival
  placed?: RefObject<boolean>;
}

export function DocumentHtml({ html, toc, placed }: DocumentHtmlProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const outline = useOutline(rootRef, html, toc);
  const find = useFindOnPage(rootRef, html);
  useFindShortcut(rootRef, find.open);
  const floating = useAtLeast(layoutBreakpoints.miniOutline);

  const closeViewer = useRef<(() => void) | null>(null);
  const openPicture = useCallback((image: HTMLImageElement): void => {
    const root = rootRef.current;
    if (root !== null) {
      closeViewer.current = openViewer(imagesOf(root), image);
    }
  }, []);
  // the viewer is a dialog on the body, so it outlives a note it is not closed with
  useEffect(
    () => () => {
      closeViewer.current?.();
      closeViewer.current = null;
    },
    [html],
  );

  useDocumentControls(rootRef, html, openPicture);
  useKatex(rootRef, html);
  useMermaid(rootRef, html);
  useFragment(rootRef, html, placed);

  return (
    <>
      {outline !== null && !floating && (
        <PageToc>
          <ReaderToc outline={outline} />
        </PageToc>
      )}

      {/* the one place in the app that injects html. What arrives here was
          rendered and sanitized on the server by the bluemonday policy in
          render/policy.go. */}
      <div
        ref={rootRef}
        data-testid="doc"
        className={`markdown-document ${classes.text}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {outline !== null && floating && <MiniOutline outline={outline} />}

      {find.opened && <FindBar find={find} />}
    </>
  );
}

// selectedText is the selection inside the note, when it is a piece of one
// line worth finding
function selectedText(root: HTMLElement): string | undefined {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0 || !root.contains(selection.anchorNode)) {
    return undefined;
  }
  const text = selection.toString().trim();
  return text === '' || text.includes('\n') ? undefined : text;
}

// useFindShortcut takes Cmd+F while the note is on screen and offers the same
// opening to the note's menu. A second Cmd+F in the bar is the browser's.
function useFindShortcut(rootRef: RefObject<HTMLDivElement | null>, open: (text?: string) => void): void {
  const { register } = useFindControl();

  useEffect(() => {
    const openHere = (): void => {
      const root = rootRef.current;
      open(root === null ? undefined : selectedText(root));
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'f') {
        return;
      }
      const { target } = event;
      if (!appShortcut(event) || (target instanceof Element && target.closest('[data-testid="doc-find"]') !== null)) {
        return;
      }
      event.preventDefault();
      openHere();
    };
    document.addEventListener('keydown', onKeyDown);
    register(openHere);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      register(undefined);
    };
  }, [rootRef, open, register]);
}
