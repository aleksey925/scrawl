import { NavLink, ScrollArea, Skeleton, Stack, Text } from '@mantine/core';
import { IconFile, IconFolder } from '@tabler/icons-react';
import type { JSX } from 'react';
import { Link, useLocation } from 'react-router';

import { api } from '../api/client';
import type { NavNode } from '../api/types';
import { errorText, useApi } from '../api/useApi';

const iconSize = 16;

function contentPathOf(pathname: string): string {
  const match = /^\/(?:p|edit|history)\/(.*)$/.exec(pathname);
  return match === null ? '' : decodeURIComponent(match[1] ?? '');
}

function NavTree({ nodes }: { nodes: NavNode[] }): JSX.Element {
  return (
    <>
      {nodes.map((node) =>
        node.is_dir ? (
          <NavLink
            key={node.path}
            component={Link}
            to={node.url}
            label={node.name}
            leftSection={<IconFolder size={iconSize} />}
            active={node.current}
            defaultOpened={node.active}
            childrenOffset={16}
          >
            <NavTree nodes={node.children} />
          </NavLink>
        ) : (
          <NavLink
            key={node.path}
            component={Link}
            to={node.url}
            label={node.name}
            leftSection={<IconFile size={iconSize} />}
            active={node.current}
          />
        ),
      )}
    </>
  );
}

export function SidebarNav(): JSX.Element {
  const location = useLocation();
  const current = contentPathOf(location.pathname);
  const nav = useApi((signal) => api.nav(current, { signal }), [current]);

  if (nav.error !== undefined) {
    return (
      <Text size="sm" c="dimmed" p="md">
        {errorText(nav.error)}
      </Text>
    );
  }

  return (
    <ScrollArea type="hover" h="100%">
      <Stack gap={2} p="xs">
        {nav.data === undefined ? (
          <>
            <Skeleton height={28} radius="sm" />
            <Skeleton height={28} radius="sm" />
            <Skeleton height={28} radius="sm" />
          </>
        ) : (
          <>
            <NavLink
              component={Link}
              to="/"
              label="All notes"
              leftSection={<IconFolder size={iconSize} />}
              active={location.pathname === '/'}
            />
            <NavTree nodes={nav.data.tree} />
          </>
        )}
      </Stack>
    </ScrollArea>
  );
}
