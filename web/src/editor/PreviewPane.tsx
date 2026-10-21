import { Alert, Box } from '@mantine/core';
import type { JSX, RefObject } from 'react';

import { DocumentHtml } from '../components/DocumentHtml';
import { EmptyState } from '../components/EmptyState';
import { IconEyeOff } from '../icons';

import classes from './Editor.module.css';

export interface PreviewPaneProps {
  html: string;
  notice: string | undefined;
  busy: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  alone: boolean;
  // the source has no text, which an html still on its way cannot say
  empty: boolean;
}

export function PreviewPane({ html, notice, busy, scrollRef, alone, empty }: PreviewPaneProps): JSX.Element {
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
      {empty ? (
        <EmptyState testId="editor-preview-empty" icon={IconEyeOff} title="Nothing to preview">
          The note has no text yet.
        </EmptyState>
      ) : (
        <DocumentHtml html={html} />
      )}
    </Box>
  );
}
