import { Group, type GroupProps } from '@mantine/core';
import type { JSX } from 'react';

import controls from '../controls.module.css';

export const dialogActionsProps: GroupProps = { className: controls.dialogActions, justify: 'flex-end', gap: 8 };

export function DialogActions({ className, ...props }: Omit<GroupProps, 'justify' | 'gap'>): JSX.Element {
  const merged = className === undefined ? controls.dialogActions : `${controls.dialogActions} ${className}`;
  return <Group {...dialogActionsProps} {...props} className={merged} />;
}
