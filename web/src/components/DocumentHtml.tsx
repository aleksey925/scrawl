import { Typography } from '@mantine/core';
import { useRef, type JSX } from 'react';

import type { Heading } from '../api/types';
import { FindBar } from '../reader/FindBar';
import { Lightbox } from '../reader/Lightbox';
import { ReaderToc } from '../reader/ReaderToc';
import { useDocumentControls } from '../reader/useDocumentControls';
import { useFindOnPage } from '../reader/useFindOnPage';
import { useKatex } from '../reader/useKatex';
import { useLightbox } from '../reader/useLightbox';
import { useMermaid } from '../reader/useMermaid';
import { useOutline } from '../reader/useOutline';
import { PageToc } from '../shell/ShellSlots';

import '../reader/markdown.css';

export interface DocumentHtmlProps {
  html: string;
  // with the headings given, the outline fills the shell's toc slot with the
  // scrollspy one: only this component holds the elements it follows
  toc?: Heading[];
}

export function DocumentHtml({ html, toc }: DocumentHtmlProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const lightbox = useLightbox(rootRef, html);
  const outline = useOutline(rootRef, html, toc);
  const find = useFindOnPage(rootRef, html);

  useDocumentControls(rootRef, html, lightbox.open);
  useKatex(rootRef, html);
  useMermaid(rootRef, html);

  return (
    <>
      {outline !== null && (
        <PageToc>
          <ReaderToc outline={outline} />
        </PageToc>
      )}

      <Typography>
        {/* the one place in the app that injects html. What arrives here was
            rendered and sanitized on the server by the bluemonday policy in
            render/policy.go. */}
        <div
          ref={rootRef}
          className="markdown-document"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </Typography>

      <Lightbox image={lightbox.image} onClose={lightbox.close} onStep={lightbox.step} />

      {find !== null && (
        <FindBar position={find.position} total={find.total} onStep={find.step} onClose={find.close} />
      )}
    </>
  );
}
