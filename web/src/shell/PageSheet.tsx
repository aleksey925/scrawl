import { useState, type JSX, type ReactNode } from 'react';

import { Sheet, SheetGroup, SheetRow } from '../components/Sheet';
import { IconEdit, IconLink, IconMoveTo, IconTrash } from '../icons';

import { useFileActions } from './fileActionsContext';
import { useAccount } from './NavContext';

export interface PageSheetProps {
  path: string;
  title: string;
  testPrefix: string;
  opened: boolean;
  onClose: () => void;
  tiles?: ReactNode;
  lead?: ReactNode;
  about?: ReactNode;
}

export function PageSheet({ path, title, testPrefix, opened, onClose, tiles, lead, about }: PageSheetProps): JSX.Element {
  const { canWrite } = useAccount();
  const actions = useFileActions();
  const [focusKept, setFocusKept] = useState(false);
  if (opened && focusKept) {
    setFocusKept(false);
  }

  const pick = (action: () => void): void => {
    onClose();
    action();
  };

  return (
    <Sheet opened={opened} onClose={onClose} title={title} testId={`${testPrefix}-dropdown`} returnFocus={!focusKept}>
      {tiles}
      <SheetGroup>
        {lead}
        <SheetRow
          testId={`${testPrefix}-copy-link`}
          icon={IconLink}
          label="Copy link"
          onClick={() => pick(() => actions.copyLink(path, false))}
        />
        {canWrite && (
          <>
            <SheetRow
              testId={`${testPrefix}-rename`}
              icon={IconEdit}
              label="Rename"
              onClick={() => {
                setFocusKept(true);
                pick(() => actions.startRename(path, false, 'page'));
              }}
            />
            <SheetRow
              testId={`${testPrefix}-move`}
              icon={IconMoveTo}
              label="Move to…"
              onClick={(event) => {
                const anchor = event.currentTarget.getBoundingClientRect();
                pick(() => actions.moveTo(path, anchor));
              }}
            />
          </>
        )}
      </SheetGroup>
      {canWrite && (
        <SheetGroup>
          <SheetRow testId={`${testPrefix}-delete`} icon={IconTrash} label="Delete" danger onClick={() => pick(() => actions.remove(path))} />
        </SheetGroup>
      )}
      {about}
    </Sheet>
  );
}
