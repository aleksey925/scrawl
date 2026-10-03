import { ActionIcon, Box, Button, Group } from '@mantine/core';
import { spotlight } from '@mantine/spotlight';
import { IconListSearch, IconSearch } from '@tabler/icons-react';
import type { JSX, ReactNode } from 'react';

import { layoutBreakpoints, useAtLeast } from '../theme';

import { AccountMenu } from './AccountMenu';
import { MoreMenu } from './MoreMenu';
import { PathCrumbs } from './PathCrumbs';
import { ProjectSwitcher } from './ProjectSwitcher';
import { SyncControl } from './SyncControl';
import { ThemeToggle } from './ThemeToggle';

export interface TopbarProps {
  burger: ReactNode;
  actionsRef: (element: HTMLElement | null) => void;
  tocAvailable: boolean;
  onOpenToc: () => void;
}

// on a phone the row holds only icons: the path moves to the top of the page
// and everything that is not about the page moves into one menu
export function Topbar({ burger, actionsRef, tocAvailable, onOpenToc }: TopbarProps): JSX.Element {
  const wide = useAtLeast(layoutBreakpoints.compactTopbar);

  return (
    <Group data-testid="topbar" h="100%" px={wide ? 'lg' : 'xs'} gap={wide ? 'sm' : 0} wrap="nowrap">
      {burger}

      <ProjectSwitcher />

      {wide ? <PathCrumbs place="topbar" /> : <Box flex={1} />}

      <Group data-testid="topbar-actions" gap={wide ? 'xs' : 0} wrap="nowrap" ref={actionsRef} />

      {wide ? (
        <Button
          data-testid="topbar-search"
          variant="default"
          size="xs"
          leftSection={<IconSearch size={16} />}
          onClick={spotlight.open}
        >
          Search
        </Button>
      ) : (
        <ActionIcon
          data-testid="topbar-search-compact"
          variant="subtle"
          color="gray"
          size="lg"
          aria-label="Search"
          onClick={spotlight.open}
        >
          <IconSearch size={18} />
        </ActionIcon>
      )}

      {wide ? (
        <>
          {tocAvailable && (
            <ActionIcon
              data-testid="topbar-toc"
              variant="subtle"
              color="gray"
              size="lg"
              aria-label="On this page"
              onClick={onOpenToc}
            >
              <IconListSearch size={18} />
            </ActionIcon>
          )}
          <SyncControl />
          <ThemeToggle />
          <AccountMenu />
        </>
      ) : (
        <MoreMenu tocAvailable={tocAvailable} onOpenToc={onOpenToc} />
      )}
    </Group>
  );
}
