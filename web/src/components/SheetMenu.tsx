import { Menu, Overlay, type MenuProps } from '@mantine/core';
import { useUncontrolled } from '@mantine/hooks';
import type { JSX } from 'react';

import { layoutBreakpoints, useBelow } from '../theme';

import classes from './SheetMenu.module.css';

// SheetMenu is mantine's Menu, which on a phone the theme draws as a sheet
// from the bottom. This adds the dimmed ground behind it, which takes the tap
// that closes it, so the tap does not land on whatever lay underneath.
export function SheetMenu({ opened, defaultOpened, onChange, children, ...rest }: MenuProps): JSX.Element {
  const phone = useBelow(layoutBreakpoints.phone);
  const [open, setOpen] = useUncontrolled({ value: opened, defaultValue: defaultOpened, finalValue: false, onChange });

  return (
    <>
      <Menu {...rest} opened={open} onChange={setOpen}>
        {children}
      </Menu>
      {phone && open && <Overlay fixed className={classes.ground} zIndex={299} />}
    </>
  );
}
