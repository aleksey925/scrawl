import { Menu, SegmentedControl } from '@mantine/core';
import type { JSX } from 'react';

import controls from '../controls.module.css';
import { layoutBreakpoints, useAtLeast } from '../theme';

import { isPageWidth, setPageWidth, usePageWidth } from './pageWidth';

const options = [
  { value: 'normal', label: 'Normal' },
  { value: 'wide', label: 'Wide' },
  { value: 'full', label: 'Full' },
];

// PageWidthControl is the width row of a menu. The width changes at once and
// the menu stays open, so the reader sees what each one does. A phone has one
// width, the screen's, and no row.
export function PageWidthControl(): JSX.Element | null {
  const picked = usePageWidth();
  const wide = useAtLeast(layoutBreakpoints.sidebar);
  if (!wide) {
    return null;
  }

  return (
    <>
      <Menu.Label>Page width</Menu.Label>
      <div className={controls.menuControl}>
        <SegmentedControl
          data-testid="page-width"
          data-width={picked}
          fullWidth
          size="xs"
          value={picked}
          onChange={(value) => {
            if (isPageWidth(value)) {
              setPageWidth(value);
            }
          }}
          aria-label="Page width"
          data={options}
        />
      </div>
    </>
  );
}
