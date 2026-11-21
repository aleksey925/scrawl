import { Text } from '@mantine/core';
import { useEffect, useState, type JSX } from 'react';
import { useNavigate } from 'react-router';

import { absoluteTime, shortDate } from '../components/formats';
import { ReadingAnchorTracker } from '../editor/ReadingAnchorTracker';
import { IconDots, IconHistory, IconOutline, IconPencil, IconSearch } from '../icons';
import { historyUrl } from '../paths';
import { useFindControl } from '../reader/findControl';
import { layoutBreakpoints, useAtLeast, useBelow } from '../theme';

import { Capsule, CapsuleAction } from './Capsule';
import type { DocumentExtrasProps } from './extensions';
import { useAccount } from './NavContext';
import { NoteMenu, NoteSheet } from './NoteMenu';
import { useReaderLayout } from './ReaderLayout';
import { PageActions, PageBar } from './ShellSlots';
import { plainShortcut } from './shortcuts';
import classes from './Topbar.module.css';
import { TopbarAction } from './TopbarAction';

export function DocumentExtras({ doc, placed }: DocumentExtrasProps): JSX.Element {
  const { canWrite } = useAccount();
  const phone = useBelow(layoutBreakpoints.phone);
  useEditShortcut(canWrite ? doc.edit_url : undefined);

  return (
    <>
      {phone ? (
        <NoteBar doc={doc} />
      ) : (
        <PageActions>
          <NoteActions doc={doc} />
        </PageActions>
      )}

      <ReadingAnchorTracker path={doc.path} rev={doc.rev} placed={placed} />
    </>
  );
}

function NoteActions({ doc }: { doc: DocumentExtrasProps['doc'] }): JSX.Element {
  const { canWrite, me } = useAccount();
  const wide = useAtLeast(layoutBreakpoints.compactTopbar);

  return (
    <>
      {wide && doc.mod_time !== '' && (
        <Text data-testid="doc-edited" component="span" className={classes.edited} title={absoluteTime(doc.mod_time)}>
          Edited {shortDate(doc.mod_time)}
        </Text>
      )}
      {canWrite && <TopbarAction testId="doc-edit" label="Edit" to={doc.edit_url} />}
      {wide && me?.history_on === true && (
        <TopbarAction testId="doc-history" label="History" icon={IconHistory} to={historyUrl(doc.path)} />
      )}
      <NoteMenu doc={doc} />
    </>
  );
}

function NoteBar({ doc }: { doc: DocumentExtrasProps['doc'] }): JSX.Element {
  const { canWrite } = useAccount();
  const { openOutline } = useReaderLayout();
  const find = useFindControl();
  const [menuOpened, setMenuOpened] = useState(false);

  return (
    <>
      <PageBar>
        {!find.opened && (
          <Capsule testId="note-bar" label="Note" kind="actions">
            {openOutline !== undefined && (
              <CapsuleAction testId="note-bar-outline" label="Outline" icon={IconOutline} onClick={openOutline} />
            )}
            {find.open !== undefined && (
              <CapsuleAction testId="note-bar-find" label="Find in note" icon={IconSearch} onClick={find.open} />
            )}
            {canWrite && <CapsuleAction testId="note-bar-edit" label="Edit" icon={IconPencil} to={doc.edit_url} />}
            <CapsuleAction
              testId="note-menu"
              label="More actions"
              icon={IconDots}
              expanded={menuOpened}
              onClick={() => setMenuOpened(true)}
            />
          </Capsule>
        )}
      </PageBar>
      <NoteSheet doc={doc} opened={menuOpened} onClose={() => setMenuOpened(false)} />
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
