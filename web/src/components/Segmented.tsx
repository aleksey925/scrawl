import { SegmentedControl, type SegmentedControlProps } from '@mantine/core';
import type { JSX, ReactNode } from 'react';

import controls from '../controls.module.css';
import type { Icon } from '../icons';
import { layout } from '../theme';

import { Hint } from './Hint';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: Icon;
  testId?: string;
  mark?: ReactNode;
}

type SegmentedProps<T extends string> = Omit<SegmentedControlProps<T>, 'data' | 'value' | 'onChange'> & {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  compact?: boolean;
};

export function Segmented<T extends string>({ options, compact = false, ...rest }: SegmentedProps<T>): JSX.Element | null {
  return (
    <SegmentedControl<T>
      {...rest}
      data={options.map(({ value, label, icon: OptionIcon, testId, mark }) => ({
        value,
        label:
          OptionIcon === undefined && testId === undefined && mark === undefined ? (
            label
          ) : (
            <Hint label={label} disabled={!compact}>
              <span data-testid={testId} className={controls.segmentOption}>
                {OptionIcon !== undefined && <OptionIcon size={layout.iconSizeSmall} />}
                <span data-segment-text className={compact ? controls.segmentTextCompact : undefined}>
                  {label}
                  {mark}
                </span>
              </span>
            </Hint>
          ),
      }))}
    />
  );
}
