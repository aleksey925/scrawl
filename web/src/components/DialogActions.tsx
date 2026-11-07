import { Group, type GroupProps } from '@mantine/core';
import type { JSX } from 'react';

import controls from '../controls.module.css';

export const dialogActionsProps: GroupProps = { className: controls.dialogActions, justify: 'flex-end', gap: 8 };

export function DialogActions(props: GroupProps): JSX.Element {
  return <Group {...dialogActionsProps} {...props} />;
}
