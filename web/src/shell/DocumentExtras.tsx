import { IconHistory, IconPencil } from '@tabler/icons-react';
import type { JSX } from 'react';

import { ReadingAnchorTracker } from '../editor/ReadingAnchorTracker';
import { historyUrl } from '../paths';
import { layoutBreakpoints, useAtLeast } from '../theme';

import { ExportMenu } from './ExportMenu';
import type { DocumentExtrasProps, NoteActionsProps } from './extensions';
import { useNav } from './NavContext';
import { PageActions } from './ShellSlots';
import { TopbarAction } from './TopbarAction';

// DocumentExtras is what the app puts around a note: the record of where the
// reader was, so the editor opens in the same place, and on a phone, where the
// note's card has no room in its head, the note's actions in the topbar
export function DocumentExtras({ doc, placed }: DocumentExtrasProps): JSX.Element {
  const wide = useAtLeast(layoutBreakpoints.compactTopbar);

  return (
    <>
      {!wide && (
        <PageActions>
          <NoteActions doc={doc} />
        </PageActions>
      )}

      <ReadingAnchorTracker path={doc.doc_path} rev={doc.rev} placed={placed} />
    </>
  );
}

// NoteActions are the way into the editor, the versions and the export
export function NoteActions({ doc }: NoteActionsProps): JSX.Element {
  const { canWrite, me } = useNav();

  return (
    <>
      {canWrite && <TopbarAction testId="doc-edit" label="Edit" icon={IconPencil} to={doc.edit_url} primary />}
      {/* reading the versions is a read, so it stays where writing does not;
          a space that records no versions has none to show */}
      {me?.history_on === true && (
        <TopbarAction testId="doc-history" label="History" icon={IconHistory} to={historyUrl(doc.doc_path)} />
      )}
      <ExportMenu path={doc.doc_path} />
    </>
  );
}
