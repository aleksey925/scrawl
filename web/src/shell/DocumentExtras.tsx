import { Text } from '@mantine/core';
import { IconHistory, IconPencil } from '@tabler/icons-react';
import { useEffect, type JSX } from 'react';
import { useNavigate } from 'react-router';

import { absoluteTime, relativeTime } from '../components/formats';
import { ReadingAnchorTracker } from '../editor/ReadingAnchorTracker';
import { historyUrl } from '../paths';
import { layoutBreakpoints, useAtLeast } from '../theme';

import type { DocumentExtrasProps } from './extensions';
import { EditButton } from './EditButton';
import { useNav } from './NavContext';
import { NoteMenu } from './NoteMenu';
import { PageActions } from './ShellSlots';
import { appShortcut, typingInto } from './shortcuts';
import classes from './Topbar.module.css';
import { TopbarAction } from './TopbarAction';

// DocumentExtras is what the app puts around a note: its actions in the
// topbar, and the record of where the reader was, so the editor opens in the
// same place
export function DocumentExtras({ doc, placed }: DocumentExtrasProps): JSX.Element {
  return (
    <>
      <PageActions>
        <NoteActions doc={doc} />
      </PageActions>

      <ReadingAnchorTracker path={doc.path} rev={doc.rev} placed={placed} />
    </>
  );
}

// NoteActions are when the note last changed, the way into the editor, its
// versions, and the rest in its menu
function NoteActions({ doc }: { doc: DocumentExtrasProps['doc'] }): JSX.Element {
  const { canWrite, me } = useNav();
  const wide = useAtLeast(layoutBreakpoints.compactTopbar);
  useEditShortcut(canWrite ? doc.edit_url : undefined);

  return (
    <>
      {wide && doc.mod_time !== '' && (
        <Text data-testid="doc-edited" component="span" className={classes.edited} title={absoluteTime(doc.mod_time)}>
          Edited {relativeTime(doc.mod_time)}
        </Text>
      )}
      {canWrite && (wide ? (
        <TopbarAction testId="doc-edit" label="Edit" icon={IconPencil} to={doc.edit_url} />
      ) : (
        <EditButton to={doc.edit_url} />
      ))}
      {/* reading the versions is a read, so it stays where writing does not;
          a space that records no versions has none to show */}
      {wide && me?.history_on === true && (
        <TopbarAction testId="doc-history" label="History" icon={IconHistory} to={historyUrl(doc.path)} />
      )}
      <NoteMenu doc={doc} />
    </>
  );
}

// useEditShortcut opens the editor on a plain E, where the note can be written
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
      if (typingInto(event.target) || !appShortcut(event)) {
        return;
      }
      event.preventDefault();
      void navigate(editUrl);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [editUrl, navigate]);
}
