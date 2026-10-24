import { Menu, SegmentedControl } from '@mantine/core';
import type { JSX } from 'react';

import controls from '../controls.module.css';
import { layoutBreakpoints, useBelow } from '../theme';

import { isPageWidth, pageWidths, setPageWidth, usePageWidth, type PageWidth } from './pageWidth';

const labels: Record<PageWidth, string> = { normal: 'Normal', wide: 'Wide', full: 'Full' };
const options = pageWidths.map((value) => ({ value, label: labels[value] }));

export function PageWidthControl({ divided = false }: { divided?: boolean }): JSX.Element | null {
  const picked = usePageWidth();
  const phone = useBelow(layoutBreakpoints.phone);
  if (phone) {
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
      {divided && <Menu.Divider />}
    </>
  );
}
