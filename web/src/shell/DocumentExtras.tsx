import { IconHistory, IconPencil } from '@tabler/icons-react';
import type { JSX } from 'react';

import { ReadingAnchorTracker } from '../editor/ReadingAnchorTracker';
import { historyUrl } from '../paths';
import { layoutBreakpoints, useAtLeast } from '../theme';

import { ExportMenu } from './ExportMenu';
import type { DocumentExtrasProps } from './extensions';
import { useNav } from './NavContext';
import { PageActions, PanelActions } from './ShellSlots';
import { TopbarAction } from './TopbarAction';

// DocumentExtras is what the app puts around a note: the way into the editor,
// the versions and the export, and the record of where the reader was, so the
// editor opens in the same place
export function DocumentExtras({ doc, placed }: DocumentExtrasProps): JSX.Element {
  const { canWrite } = useNav();
  const Actions = useAtLeast(layoutBreakpoints.tocRail) ? PanelActions : PageActions;

  return (
    <>
      <Actions>
        {canWrite && <TopbarAction testId="doc-edit" label="Edit" icon={IconPencil} to={doc.edit_url} primary />}
        {/* reading the versions is a read, so it stays where writing does not */}
        <TopbarAction testId="doc-history" label="History" icon={IconHistory} to={historyUrl(doc.doc_path)} />
        <ExportMenu path={doc.doc_path} />
      </Actions>

      <ReadingAnchorTracker path={doc.doc_path} rev={doc.rev} placed={placed} />
    </>
  );
}
