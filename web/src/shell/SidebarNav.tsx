import {
  ActionIcon, Anchor, Box, Button, Group, Highlight, ScrollArea, Skeleton, Stack, Text, TextInput,
} from '@mantine/core';
import {
  IconChevronRight, IconFile, IconFolder, IconFolderPlus, IconPlus, IconSearch, IconX,
} from '@tabler/icons-react';
import { useEffect, useMemo, useRef, type JSX, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router';

import type { NavNode } from '../api/types';
import { errorText } from '../api/useApi';
import { displayName } from '../paths';
import { layout, layoutBreakpoints, useBelow } from '../theme';

import { useFileActions } from './FileActions';
import { useNav } from './NavContext';
import { RowMenu } from './RowMenu';
import { filterTree, type FilteredTree } from './treeFilter';

const iconSize = 16;
const deskRowHeight = 30;

interface RowsProps {
  nodes: readonly NavNode[];
  depth: number;
  filtered: FilteredTree;
  query: string;
  touch: boolean;
}

type TreeRowProps = Omit<RowsProps, 'nodes'> & { node: NavNode };

function TreeRow({ node, depth, filtered, query, touch }: TreeRowProps): JSX.Element | null {
  const { isOpen, openFolder, toggleFolder } = useNav();

  if (query !== '' && !filtered.visible.has(node.path)) {
    return null;
  }

  const label = displayName(node.name);
  const open = query === '' ? isOpen(node.path) : filtered.forcedOpen.has(node.path);

  return (
    <Box style={{ minWidth: 0 }}>
      <Group
        gap={2}
        wrap="nowrap"
        pr={4}
        data-nav-current={node.current ? 'true' : undefined}
        style={{
          minWidth: 0,
          minHeight: touch ? layout.tapTarget : deskRowHeight,
          paddingLeft: depth * 14,
          borderRadius: 'var(--mantine-radius-sm)',
          background: node.current ? 'var(--scrawl-accent-subtle)' : undefined,
        }}
      >
        {node.is_dir ? (
          <ActionIcon
            variant="subtle"
            color="gray"
            size={touch ? 'lg' : 'sm'}
            style={{ flex: 'none' }}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`}
            aria-expanded={open}
            onClick={() => toggleFolder(node.path)}
          >
            <IconChevronRight size={14} style={{ transform: open ? 'rotate(90deg)' : undefined }} />
          </ActionIcon>
        ) : (
          <Box w={touch ? layout.tapTarget : 22} style={{ flex: 'none' }} />
        )}

        <Anchor
          component={Link}
          to={node.url}
          underline="never"
          aria-current={node.current ? 'page' : undefined}
          // a section label opens its folder page and expands the row; only the
          // chevron beside it may collapse again
          onClick={() => node.is_dir && openFolder(node.path)}
          style={{ flex: '1 1 auto', minWidth: 0, color: 'inherit' }}
        >
          <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
            {node.is_dir ? (
              <IconFolder size={iconSize} style={{ flex: 'none' }} />
            ) : (
              <IconFile size={iconSize} style={{ flex: 'none' }} />
            )}
            <Highlight
              size="sm"
              truncate
              highlight={query === '' ? [] : query}
              fw={node.current ? 600 : undefined}
              c={node.current ? 'var(--scrawl-accent)' : undefined}
              style={{ minWidth: 0 }}
            >
              {label}
            </Highlight>
          </Group>
        </Anchor>

        <RowMenu path={node.path} isDir={node.is_dir} name={label} touch={touch} />
      </Group>

      {node.is_dir && open && node.children.length > 0 && (
        <TreeRows nodes={node.children} depth={depth + 1} filtered={filtered} query={query} touch={touch} />
      )}
    </Box>
  );
}

function TreeRows({ nodes, depth, filtered, query, touch }: RowsProps): JSX.Element {
  return (
    <>
      {nodes.map((node) => (
        <TreeRow
          key={node.path}
          node={node}
          depth={depth}
          filtered={filtered}
          query={query}
          touch={touch}
        />
      ))}
    </>
  );
}

export function SidebarNav(): JSX.Element {
  const navigate = useNavigate();
  const { tree, error, loading, canWrite, currentPath, query, setQuery } = useNav();
  const actions = useFileActions();
  const touch = useBelow(layoutBreakpoints.sidebar);
  const viewportRef = useRef<HTMLDivElement>(null);

  const trimmed = query.trim().toLowerCase();
  const filtered = useMemo(() => filterTree(tree, trimmed), [tree, trimmed]);

  // the panel starts at the top after a navigation, which on a corpus taller
  // than it leaves the page just opened somewhere off screen
  useEffect(() => {
    const viewport = viewportRef.current;
    const row = viewport?.querySelector<HTMLElement>('[data-nav-current="true"]');
    if (viewport === null || row === null || row === undefined) {
      return;
    }
    const rowBox = row.getBoundingClientRect();
    const hostBox = viewport.getBoundingClientRect();
    if (rowBox.top >= hostBox.top && rowBox.bottom <= hostBox.bottom) {
      return;
    }
    viewport.scrollTop += rowBox.top - hostBox.top - (viewport.clientHeight - rowBox.height) / 2;
  }, [currentPath, tree]);

  function onFilterKey(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (trimmed === '') {
        return;
      }
      // a folder whose child matched is on screen too and comes first in
      // document order, so the query is matched again rather than trusted
      const first = filtered.matches[0];
      void navigate(first === undefined ? `/search?q=${encodeURIComponent(query.trim())}` : first.url);
      return;
    }
    if (event.key === 'Escape' && query !== '') {
      event.stopPropagation();
      setQuery('');
    }
  }

  return (
    <Stack gap="xs" h="100%" style={{ minWidth: 0 }}>
      <Box px="xs" pt="xs">
        <TextInput
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={onFilterKey}
          placeholder="Filter notes"
          aria-label="Filter notes"
          size={touch ? 'md' : 'sm'}
          leftSection={<IconSearch size={iconSize} />}
          rightSectionPointerEvents="all"
          rightSection={
            query === '' ? null : (
              // a touch keyboard has no Escape, so this is the only way out of
              // a query on a phone
              <ActionIcon
                variant="subtle"
                color="gray"
                size={touch ? 'lg' : 'sm'}
                aria-label="Clear the filter"
                onClick={() => setQuery('')}
              >
                <IconX size={14} />
              </ActionIcon>
            )
          }
          styles={{ input: { fontSize: layout.inputFontSize } }}
        />
      </Box>

      <ScrollArea type="hover" viewportRef={viewportRef} style={{ flex: '1 1 auto', minWidth: 0 }}>
        <Box px="xs" pb="xs" style={{ minWidth: 0 }}>
          {error !== undefined ? (
            <Text size="sm" c="dimmed">
              {errorText(error)}
            </Text>
          ) : loading && tree.length === 0 ? (
            <Stack gap={6}>
              <Skeleton height={24} radius="sm" />
              <Skeleton height={24} radius="sm" />
              <Skeleton height={24} radius="sm" />
            </Stack>
          ) : trimmed !== '' && filtered.matches.length === 0 ? (
            <Text size="sm" c="dimmed">
              Nothing matches. Press Enter to search the text of every note.
            </Text>
          ) : (
            <TreeRows nodes={tree} depth={0} filtered={filtered} query={trimmed} touch={touch} />
          )}
        </Box>
      </ScrollArea>

      {canWrite && (
        <Group gap="xs" px="xs" pb="xs" wrap="nowrap">
          <Button
            variant="default"
            size={touch ? 'sm' : 'xs'}
            leftSection={<IconPlus size={14} />}
            onClick={() => actions.createPage('')}
            style={{ flex: '1 1 0', minWidth: 0 }}
          >
            New page
          </Button>
          <Button
            variant="default"
            size={touch ? 'sm' : 'xs'}
            leftSection={<IconFolderPlus size={14} />}
            onClick={() => actions.createFolder('')}
            style={{ flex: '1 1 0', minWidth: 0 }}
          >
            New folder
          </Button>
        </Group>
      )}
    </Stack>
  );
}
