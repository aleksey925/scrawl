import { SegmentedControl, type SegmentedControlProps } from '@mantine/core';
import type { JSX } from 'react';

import controls from '../controls.module.css';
import type { Icon } from '../icons';
import { layout } from '../theme';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: Icon;
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
      data={options.map(({ value, label, icon: OptionIcon }) => ({
        value,
        label:
          OptionIcon === undefined ? (
            label
          ) : (
            <span className={controls.segmentOption} title={compact ? label : undefined}>
              <OptionIcon size={layout.iconSizeSmall} />
              <span data-segment-text className={compact ? controls.segmentTextCompact : undefined}>
                {label}
              </span>
            </span>
          ),
      }))}
    />
  );
}
