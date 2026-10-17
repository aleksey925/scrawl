import { useCallback, useEffect, useRef, type JSX, type RefObject } from 'react';

import type { Heading } from '../api/types';
import { imagesOf } from '../reader/dom';
import { FindBar } from '../reader/FindBar';
import { ReaderToc } from '../reader/ReaderToc';
import { useDocumentControls } from '../reader/useDocumentControls';
import { useFindOnPage } from '../reader/useFindOnPage';
import { useFragment } from '../reader/useFragment';
import { useKatex } from '../reader/useKatex';
import { useMermaid } from '../reader/useMermaid';
import { useOutline } from '../reader/useOutline';
import { openViewer } from '../reader/viewer';
import { PageToc } from '../shell/ShellSlots';

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
      {outline !== null && (
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
        className="markdown-document"
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {find !== null && (
        <FindBar position={find.position} total={find.total} onStep={find.step} onClose={find.close} />
      )}
    </>
  );
}
