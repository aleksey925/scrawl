import { VisuallyHidden } from '@mantine/core';
import type { JSX } from 'react';

import { IconCloudUp } from '../icons';
import { layout } from '../theme';

import { useAccount } from './NavContext';

export interface SyncBadgeProps {
  path: string;
}

export function SyncBadge({ path }: SyncBadgeProps): JSX.Element | null {
  const { isUnsynced } = useAccount();
  if (!isUnsynced(path)) {
    return null;
  }
  return (
    <span data-testid="sync-badge" data-path={path} style={{ display: 'inline-flex', flex: 'none' }}>
      <IconCloudUp size={layout.iconSizeTiny} aria-hidden color="var(--scrawl-color-orange)" />
      <VisuallyHidden>, not pushed to the remote</VisuallyHidden>
    </span>
  );
}
