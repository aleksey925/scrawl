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
import { useDiagrams } from '../reader/useDiagrams';
import { useOutline } from '../reader/useOutline';
import { openViewer } from '../reader/viewer';
import { PageToc } from '../shell/ShellSlots';
import { appShortcut, modChord } from '../shell/shortcuts';
import { layoutBreakpoints, useAtLeast } from '../theme';

import classes from './DocumentHtml.module.css';

import '../reader/markdown.css';

export interface DocumentHtmlProps {
  html: string;
  toc?: Heading[];
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
  useEffect(
    () => () => {
      closeViewer.current?.();
      closeViewer.current = null;
    },
    [html],
  );

  useDocumentControls(rootRef, html, openPicture);
  useKatex(rootRef, html);
  useDiagrams(rootRef, html);
  useFragment(rootRef, html, placed);

  return (
    <>
      {outline !== null && !floating && (
        <PageToc>
          <ReaderToc outline={outline} />
        </PageToc>
      )}

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

function selectedText(root: HTMLElement): string | undefined {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0 || !root.contains(selection.anchorNode)) {
    return undefined;
  }
  const text = selection.toString().trim();
  return text === '' || text.includes('\n') ? undefined : text;
}

function useFindShortcut(rootRef: RefObject<HTMLDivElement | null>, open: (text?: string) => void): void {
  const { register } = useFindControl();

  useEffect(() => {
    const openHere = (): void => {
      const root = rootRef.current;
      open(root === null ? undefined : selectedText(root));
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!modChord(event, 'f') || !appShortcut(event)) {
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
