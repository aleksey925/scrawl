import type { JSX, MouseEvent as ReactMouseEvent, ReactNode } from 'react';

import { Hint } from '../components/Hint';
import { optionDisabled, type FindOption, type FindOptions } from './findOptions';
import classes from './FindToggles.module.css';

const buttons: readonly { name: FindOption; testId: string; label: string; face: ReactNode }[] = [
  { name: 'matchCase', testId: 'case', label: 'Match case', face: 'Aa' },
  { name: 'word', testId: 'word', label: 'Whole word', face: <u>ab</u> },
  { name: 'regex', testId: 'regex', label: 'Regular expression', face: '.*' },
  { name: 'fuzzy', testId: 'fuzzy', label: 'Fuzzy', face: '≈' },
];

export interface FindTogglesProps {
  options: FindOptions;
  testIdPrefix: string;
  className: string | undefined;
  onToggle: (name: FindOption) => void;
  onMouseDown?: (event: ReactMouseEvent) => void;
}

export function FindToggles({ options, testIdPrefix, className, onToggle, onMouseDown }: FindTogglesProps): JSX.Element {
  return (
    <>
      {buttons.map((entry) => (
        <Hint key={entry.name} label={entry.label}>
          <button
            type="button"
            data-testid={`${testIdPrefix}-${entry.testId}`}
            data-on={options[entry.name] ? 'true' : 'false'}
            className={`${classes.toggle} ${className}`}
            aria-label={entry.label}
            aria-pressed={options[entry.name]}
            disabled={optionDisabled(options, entry.name)}
            onMouseDown={onMouseDown}
            onClick={() => onToggle(entry.name)}
          >
            {entry.face}
          </button>
        </Hint>
      ))}
    </>
  );
}
