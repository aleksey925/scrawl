import { VisuallyHidden } from '@mantine/core';
import type { JSX } from 'react';

import { IconCloudUp } from '../icons';
import { layout } from '../theme';

import { useNav } from './NavContext';

export interface SyncBadgeProps {
  path: string;
}

// SyncBadge marks one note the remote does not have. It renders nothing when
// the note is fine, and nothing at all once the path set was dropped above its
// cap - isUnsynced answers false for everything then, so the degraded form
// draws no badges by construction.
//
// The icon is aria-hidden and the meaning is in hidden text beside it: an <svg>
// is not focusable, so a tooltip on one never opens on keyboard focus and an
// aria-label on an element with no role is not reliably announced.
export function SyncBadge({ path }: SyncBadgeProps): JSX.Element | null {
  const { isUnsynced } = useNav();
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
