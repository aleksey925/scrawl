import { ActionIcon, Box, Group, Kbd, UnstyledButton } from '@mantine/core';
import { spotlight } from '@mantine/spotlight';
import { IconListSearch, IconSearch } from '@tabler/icons-react';
import type { JSX, ReactNode } from 'react';

import { usePlatform } from '../platform';
import { iconEdgeInset, layout, layoutBreakpoints, useAtLeast } from '../theme';

import { MoreMenu } from './MoreMenu';
import { PathCrumbs } from './PathCrumbs';
import classes from './Topbar.module.css';

// TopbarChrome is what the app adds to the bar. Without it the bar holds the
// reader's own controls and one menu with the theme, at every width.
export interface TopbarChrome {
  // beside the burger
  start?: ReactNode;
  // at the end on a wide screen, and the one menu on a phone
  wide?: ReactNode;
  compact?: ReactNode;
}

export interface TopbarProps {
  burger: ReactNode;
  chrome?: TopbarChrome;
  actionsRef: (element: HTMLElement | null) => void;
  tocAvailable: boolean;
  onOpenToc: () => void;
}

// on a phone the row holds only icons: the path moves to the top of the page
// and everything that is not about the page moves into one menu
export function Topbar({ burger, chrome, actionsRef, tocAvailable, onOpenToc }: TopbarProps): JSX.Element {
  const wide = useAtLeast(layoutBreakpoints.compactTopbar);
  const { search } = usePlatform();

  return (
    <Group data-testid="topbar" h="100%" px={wide ? 'lg' : iconEdgeInset(layout.topbarIconSize)} gap={wide ? 'sm' : 0} wrap="nowrap">
      {burger}

      {chrome?.start}

      {wide ? <PathCrumbs place="topbar" /> : <Box flex={1} />}

      <Group data-testid="topbar-actions" gap={wide ? 'xs' : 0} wrap="nowrap" ref={actionsRef} />

      {search && wide && (
        <UnstyledButton data-testid="topbar-search" className={classes.search} onClick={spotlight.open}>
          <IconSearch size={16} />
          <span className={classes.searchLabel}>Search notes</span>
          <Kbd size="xs">/</Kbd>
        </UnstyledButton>
      )}
      {search && !wide && (
        <ActionIcon
          data-testid="topbar-search-compact"
          variant="subtle"
          color="gray"
          size="lg"
          aria-label="Search"
          onClick={spotlight.open}
        >
          <IconSearch size={layout.topbarIconSize} />
        </ActionIcon>
      )}

      {tocAvailable && (
        <ActionIcon
          data-testid="topbar-toc"
          variant="subtle"
          color="gray"
          size="lg"
          aria-label="On this page"
          onClick={onOpenToc}
        >
          <IconListSearch size={layout.topbarIconSize} />
        </ActionIcon>
      )}

      {wide ? (chrome?.wide ?? <MoreMenu />) : (chrome?.compact ?? <MoreMenu />)}
    </Group>
  );
}
