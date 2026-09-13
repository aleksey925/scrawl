import { Alert, Box } from '@mantine/core';
import type { JSX, RefObject } from 'react';

import { DocumentHtml } from '../components/DocumentHtml';

import classes from './Editor.module.css';

export interface PreviewPaneProps {
  html: string;
  notice: string | undefined;
  busy: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  alone: boolean;
}

export function PreviewPane({ html, notice, busy, scrollRef, alone }: PreviewPaneProps): JSX.Element {
  return (
    <Box
      ref={scrollRef}
      data-testid="editor-preview"
      data-busy={busy ? 'true' : 'false'}
      data-alone={alone ? 'true' : 'false'}
      className={`${classes.pane} ${classes.grow} ${classes.preview} ${alone ? classes.previewOnly : ''}`}
      aria-live="polite"
      aria-busy={busy}
    >
      {notice !== undefined && (
        <Alert data-testid="editor-preview-notice" color="yellow" variant="light" mb="md">
          {notice}
        </Alert>
      )}
      <DocumentHtml html={html} />
    </Box>
  );
}
