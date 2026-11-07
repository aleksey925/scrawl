import type { JSX, ReactNode } from 'react';

import { useFileActions, type Renaming } from '../shell/fileActionsContext';
import { basenameOf } from '../shell/naming';

import { NameField } from './NameField';

export interface RenameFieldProps {
  session: Renaming;
  testId: string;
  icon?: ReactNode;
  className?: string;
}

export function RenameField({ session, testId, icon, className }: RenameFieldProps): JSX.Element {
  const { submitRename, endRename, renameCommit } = useFileActions();
  const name = basenameOf(session.path);
  return (
    <NameField
      key={session.id}
      initial={name}
      isDir={session.isDir}
      label={`New name of ${name}`}
      testId={testId}
      icon={icon}
      className={className}
      commitRef={renameCommit}
      onSubmit={async (typed) => {
        const saved = await submitRename(session.path, session.isDir, typed);
        if (saved) {
          endRename(session.id);
        }
        return saved;
      }}
      onCancel={() => endRename(session.id)}
    />
  );
}
