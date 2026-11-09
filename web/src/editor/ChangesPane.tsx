import { Alert, Box, Center, Loader } from '@mantine/core';
import type { JSX } from 'react';

import { EmptyState } from '../components/EmptyState';
import { RenderedDiff, type DiffLayout } from '../diff/RenderedDiff';
import { IconDiff } from '../icons';

import classes from './Editor.module.css';
import type { ChangesState } from './useChanges';

export interface ChangesPaneProps {
  changes: ChangesState;
  layout: DiffLayout;
}

function ChangesBody({ changes, layout }: ChangesPaneProps): JSX.Element {
  if (changes.same) {
    return (
      <EmptyState testId="editor-changes-none" icon={IconDiff} title="No changes">
        The note is the same as the saved one.
      </EmptyState>
    );
  }
  if (changes.notice !== undefined) {
    return (
      <Alert data-testid="editor-changes-notice" color="yellow" variant="light">
        {changes.notice}
      </Alert>
    );
  }
  if (changes.rows === undefined) {
    return (
      <Center data-testid="editor-changes-loading" py="xl">
        <Loader size="sm" />
      </Center>
    );
  }
  return (
    <RenderedDiff
      rows={changes.rows}
      layout={layout}
      oldLabel="Saved"
      newLabel="Unsaved"
      version={String(changes.version)}
    />
  );
}

export function ChangesPane(props: ChangesPaneProps): JSX.Element {
  return (
    <Box
      data-testid="editor-changes"
      className={`${classes.pane} ${classes.grow} ${classes.preview} ${classes.previewOnly} ${classes.changes}`}
    >
      <ChangesBody {...props} />
    </Box>
  );
}
