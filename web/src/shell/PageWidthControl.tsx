import { Menu } from '@mantine/core';
import type { JSX } from 'react';

import { Segmented, type SegmentedOption } from '../components/Segmented';
import controls from '../controls.module.css';
import { layoutBreakpoints, useBelow } from '../theme';

import { pageWidths, setPageWidth, usePageWidth, type PageWidth } from './pageWidth';

const labels: Record<PageWidth, string> = { normal: 'Normal', wide: 'Wide', full: 'Full' };
const options: SegmentedOption<PageWidth>[] = pageWidths.map((value) => ({ value, label: labels[value] }));

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
        <Segmented
          data-testid="page-width"
          data-width={picked}
          fullWidth
          size="xs"
          value={picked}
          onChange={setPageWidth}
          aria-label="Page width"
          options={options}
        />
      </div>
      {divided && <Menu.Divider />}
    </>
  );
}
