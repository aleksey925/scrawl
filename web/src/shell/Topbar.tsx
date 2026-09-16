import { ActionIcon, Anchor, Breadcrumbs, Button, Group, Text } from '@mantine/core';
import { spotlight } from '@mantine/spotlight';
import { IconListSearch, IconSearch } from '@tabler/icons-react';
import type { JSX, ReactNode } from 'react';
import { Link, useLocation } from 'react-router';

import controls from '../controls.module.css';
import { directoryUrl, displayName, documentUrl } from '../paths';
import { layoutBreakpoints } from '../theme';

import { AccountMenu } from './AccountMenu';
import { contentPathOf } from './naming';
import { ProjectSwitcher } from './ProjectSwitcher';
import { ThemeToggle } from './ThemeToggle';

interface Crumb {
  name: string;
  url?: string;
}

function crumbsOf(pathname: string): Crumb[] {
  const content = contentPathOf(pathname);
  const segments = content.split('/').filter((segment) => segment !== '');

  const res: Crumb[] = [{ name: 'Home', url: '/' }];
  let prefix = '';
  segments.forEach((segment, index) => {
    prefix = prefix === '' ? segment : `${prefix}/${segment}`;
    const last = index === segments.length - 1;
    res.push({
      name: displayName(segment),
      url: last ? undefined : directoryUrl(prefix),
    });
  });
  if (segments.length > 0) {
    const last = res[res.length - 1];
    if (last !== undefined && content.endsWith('/')) {
      last.url = documentUrl(content);
    }
  }
  return res;
}

export interface TopbarProps {
  burger: ReactNode;
  actionsRef: (element: HTMLElement | null) => void;
  tocAvailable: boolean;
  onOpenToc: () => void;
}

export function Topbar({ burger, actionsRef, tocAvailable, onOpenToc }: TopbarProps): JSX.Element {
  const location = useLocation();
  const crumbs = crumbsOf(location.pathname);

  return (
    <Group data-testid="topbar" className={controls.topbar} h="100%" px="lg" gap="sm" wrap="nowrap">
      {burger}

      <ProjectSwitcher />

      <Breadcrumbs
        data-testid="topbar-breadcrumbs"
        separator="/"
        style={{ minWidth: 0, flex: '1 1 auto', overflow: 'hidden' }}
      >
        {crumbs.map((crumb, index) =>
          crumb.url === undefined ? (
            <Text
              key={`${crumb.name}-${index}`}
              data-testid="topbar-crumb"
              data-current="true"
              size="sm"
              fw={500}
              truncate
            >
              {crumb.name}
            </Text>
          ) : (
            <Anchor
              key={`${crumb.name}-${index}`}
              data-testid="topbar-crumb"
              data-current="false"
              component={Link}
              to={crumb.url}
              size="sm"
              c="dimmed"
            >
              {crumb.name}
            </Anchor>
          ),
        )}
      </Breadcrumbs>

      <Group data-testid="topbar-actions" gap="xs" wrap="nowrap" ref={actionsRef} />

      <Button
        data-testid="topbar-search"
        variant="default"
        size="xs"
        leftSection={<IconSearch size={16} />}
        onClick={spotlight.open}
        visibleFrom={layoutBreakpoints.compactTopbar}
      >
        Search
      </Button>
      <ActionIcon
        data-testid="topbar-search-compact"
        variant="subtle"
        color="gray"
        size="lg"
        aria-label="Search"
        onClick={spotlight.open}
        hiddenFrom={layoutBreakpoints.compactTopbar}
      >
        <IconSearch size={18} />
      </ActionIcon>

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

      <ThemeToggle />
      <AccountMenu />
    </Group>
  );
}
