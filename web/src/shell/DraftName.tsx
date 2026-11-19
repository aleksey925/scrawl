import type { JSX, MutableRefObject, ReactNode } from 'react';

import { NameField } from '../components/NameField';

import { basenameOf } from './naming';
import type { DraftChrome } from './PageChrome';

export interface DraftNameFieldProps {
  draft: DraftChrome;
  icon?: ReactNode;
  className?: string;
  commitRef?: MutableRefObject<(() => void) | undefined>;
  onDone: () => void;
}

export function DraftNameField({ draft, icon, className, commitRef, onDone }: DraftNameFieldProps): JSX.Element {
  return (
    <NameField
      initial={basenameOf(draft.path)}
      label="Name of the new note"
      testId="draft-name"
      icon={icon}
      className={className}
      commitRef={commitRef}
      onSubmit={async (typed) => {
        const named = draft.rename(typed);
        if (named) {
          onDone();
        }
        return named;
      }}
      onCancel={onDone}
    />
  );
}
