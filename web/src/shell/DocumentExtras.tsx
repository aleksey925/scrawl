import { Text } from '@mantine/core';
import { useEffect, type JSX } from 'react';
import { useNavigate } from 'react-router';

import { absoluteTime, shortDate } from '../components/formats';
import { ReadingAnchorTracker } from '../editor/ReadingAnchorTracker';
import { IconHistory } from '../icons';
import { historyUrl } from '../paths';
import { layoutBreakpoints, useAtLeast } from '../theme';

import type { DocumentExtrasProps } from './extensions';
import { useOfferEdit } from './barEdit';
import { EditAction } from './EditAction';
import { useAccount } from './NavContext';
import { NoteMenu } from './NoteMenu';
import { PageActions } from './ShellSlots';
import { plainShortcut } from './shortcuts';
import classes from './Topbar.module.css';
import { TopbarAction } from './TopbarAction';

export function DocumentExtras({ doc, placed }: DocumentExtrasProps): JSX.Element {
  useOfferEdit(doc.edit_url);
  return (
    <>
      <PageActions>
        <NoteActions doc={doc} />
      </PageActions>

      <ReadingAnchorTracker path={doc.path} rev={doc.rev} placed={placed} />
    </>
  );
}

function NoteActions({ doc }: { doc: DocumentExtrasProps['doc'] }): JSX.Element {
  const { canWrite, me } = useAccount();
  const wide = useAtLeast(layoutBreakpoints.compactTopbar);
  useEditShortcut(canWrite ? doc.edit_url : undefined);

  return (
    <>
      {wide && doc.mod_time !== '' && (
        <Text data-testid="doc-edited" component="span" className={classes.edited} title={absoluteTime(doc.mod_time)}>
          Edited {shortDate(doc.mod_time)}
        </Text>
      )}
      {canWrite && <EditAction testId="doc-edit" to={doc.edit_url} />}
      {wide && me?.history_on === true && (
        <TopbarAction testId="doc-history" label="History" icon={IconHistory} to={historyUrl(doc.path)} />
      )}
      <NoteMenu doc={doc} />
    </>
  );
}

function useEditShortcut(editUrl: string | undefined): void {
  const navigate = useNavigate();

  useEffect(() => {
    if (editUrl === undefined) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'e' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }
      if (!plainShortcut(event)) {
        return;
      }
      event.preventDefault();
      void navigate(editUrl);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [editUrl, navigate]);
}
