import {
  ActionIcon, Anchor, Box, Button, Group, Highlight, ScrollArea, Skeleton, Stack, Text, TextInput,
} from '@mantine/core';
import {
  IconChevronRight, IconFile, IconFolder, IconFolderPlus, IconPlus, IconSearch, IconX,
} from '@tabler/icons-react';
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type DragEvent, type JSX, type KeyboardEvent, type MouseEvent,
} from 'react';
import { Link, useNavigate } from 'react-router';

import type { NavNode } from '../api/types';
import { errorText } from '../api/useApi';
import { displayName } from '../paths';
import { layout, layoutBreakpoints, useBelow } from '../theme';

import { folderFor, useFileActions } from './FileActions';
import { useNav } from './NavContext';
import { SyncBadge } from './SyncBadge';
import { RowMenu } from './RowMenu';
import { basenameOf, parentOf } from './naming';
import { filterTree, type FilteredTree } from './treeFilter';

const iconSize = 16;
const deskRowHeight = 30;

// focusSettleMs is how long the draft row waits before it believes a blur.
// Measured against mantine's menu, which returns focus to its trigger when it
// closes; anything shorter and the row cancels itself as it appears.
const focusSettleMs = 150;

// springOpenMs is how long a drag has to rest on a closed folder before it
// opens. Long enough that crossing one on the way somewhere else does nothing,
// short enough that aiming at it reads as holding it.
const springOpenMs = 600;

// TreeUi is what the rows share and the tree owns: which rows are picked, which
// one is being dragged over, and the order the rows are in on screen, which is
// the only thing a shift-click range can be measured against.
interface TreeUi {
  selected: ReadonlySet<string>;
  dropTarget: string | undefined;
  canWrite: boolean;
  pick: (path: string, event: MouseEvent) => void;
  startDrag: (path: string, event: DragEvent) => void;
  endDrag: () => void;
  overFolder: (folder: string, event: DragEvent) => void;
  leaveFolder: (folder: string) => void;
  dropOn: (folder: string, event: DragEvent) => void;
}

const TreeUiContext = createContext<TreeUi | undefined>(undefined);

function useTreeUi(): TreeUi {
  const ui = useContext(TreeUiContext);
  if (ui === undefined) {
    throw new Error('tree rows only render inside the sidebar');
  }
  return ui;
}

interface RowsProps {
  nodes: readonly NavNode[];
  depth: number;
  filtered: FilteredTree;
  query: string;
  touch: boolean;
}

type TreeRowProps = Omit<RowsProps, 'nodes'> & { node: NavNode };

function TreeRow({ node, depth, filtered, query, touch }: TreeRowProps): JSX.Element | null {
  const { isOpen, openFolder, toggleFolder, currentPath } = useNav();
  const { draft } = useFileActions();
  const ui = useTreeUi();

  if (query !== '' && !filtered.visible.has(node.path)) {
    return null;
  }

  const label = displayName(node.name);
  const open = query === '' ? isOpen(node.path) : filtered.forcedOpen.has(node.path);
  // the route decides this and not the answer the server sent with the tree:
  // the click has already happened, and a highlight that waits for a round trip
  // is a click that did nothing for as long as the round trip took
  const current = node.path === currentPath;
  const picked = ui.selected.has(node.path);
  const over = ui.dropTarget === node.path;
  const drafting = draft !== undefined && draft.parent === node.path;

  return (
    <Box style={{ minWidth: 0 }}>
      <Group
        gap={2}
        wrap="nowrap"
        pr={4}
        data-testid="tree-row"
        data-current={current ? 'true' : 'false'}
        data-selected={picked ? 'true' : 'false'}
        data-drop={over ? 'true' : 'false'}
        data-dir={node.is_dir ? 'true' : 'false'}
        data-path={node.path}
        draggable={ui.canWrite}
        onDragStart={(event) => ui.startDrag(node.path, event)}
        onDragEnd={ui.endDrag}
        onDragOver={(event) => ui.overFolder(folderFor(node.path, node.is_dir), event)}
        onDragLeave={() => ui.leaveFolder(folderFor(node.path, node.is_dir))}
        onDrop={(event) => ui.dropOn(folderFor(node.path, node.is_dir), event)}
        style={{
          minWidth: 0,
          minHeight: touch ? layout.tapTarget : deskRowHeight,
          paddingLeft: depth * 14,
          borderRadius: 'var(--mantine-radius-sm)',
          background: rowBackground(current, picked, over),
          // a row that is being dragged onto is a target and not a button: the
          // outline says where the drop lands without moving anything
          outline: over ? '1px solid var(--scrawl-accent)' : undefined,
          outlineOffset: -1,
          transition: 'background-color 120ms ease',
        }}
      >
        {node.is_dir ? (
          <ActionIcon
            data-testid="tree-twisty"
            data-open={open ? 'true' : 'false'}
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
          data-testid="tree-link"
          component={Link}
          to={node.url}
          underline="never"
          draggable={false}
          aria-current={current ? 'page' : undefined}
          // a section label opens its folder page and expands the row; only the
          // chevron beside it may collapse again
          onClick={(event: MouseEvent) => {
            ui.pick(node.path, event);
            if (node.is_dir && !event.defaultPrevented) {
              openFolder(node.path);
            }
          }}
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
              fw={current ? 600 : undefined}
              c={current ? 'var(--scrawl-accent)' : undefined}
              style={{ minWidth: 0 }}
            >
              {label}
            </Highlight>
          </Group>
        </Anchor>

        {/* outside the link, so the link's accessible name stays the note's
            name and the badge reads beside it */}
        <SyncBadge path={node.path} />

        <RowMenu path={node.path} isDir={node.is_dir} name={label} touch={touch} />
      </Group>

      {node.is_dir && open && (
        <>
          {drafting && <DraftRow depth={depth + 1} touch={touch} />}
          {node.children.length > 0 && (
            <TreeRows nodes={node.children} depth={depth + 1} filtered={filtered} query={query} touch={touch} />
          )}
        </>
      )}
    </Box>
  );
}

function rowBackground(current: boolean, picked: boolean, over: boolean): string | undefined {
  if (over) {
    return 'var(--scrawl-accent-subtle)';
  }
  if (current) {
    return 'var(--scrawl-accent-subtle)';
  }
  return picked ? 'var(--mantine-color-default-hover)' : undefined;
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

// DraftRow is the new entry before it exists. Enter creates it, Escape drops
// it, and leaving the field does too: an input the reader walked away from is
// not a file they asked for.
function DraftRow({ depth, touch }: { depth: number; touch: boolean }): JSX.Element {
  const { draft, submitDraft, cancelDraft } = useFileActions();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // a menu item is one of the ways this row is opened, and mantine's menu hands
  // focus back to the button it closed under - a tick after this row mounted
  // and took it. Until the dust settles a blur says nothing about the reader.
  const settled = useRef(false);
  const page = draft?.kind === 'file';

  useEffect(() => {
    const id = window.setTimeout(() => {
      settled.current = true;
      if (document.activeElement !== inputRef.current) {
        inputRef.current?.focus();
      }
    }, focusSettleMs);
    return () => window.clearTimeout(id);
  }, []);

  const commit = (): void => {
    if (busy || name.trim() === '') {
      cancelDraft();
      return;
    }
    setBusy(true);
    void submitDraft(name).then((created) => {
      setBusy(false);
      if (!created) {
        // the name stays on screen, because retyping it is the one thing the
        // reader should not have to do after "that already exists"
        return;
      }
      setName('');
    });
  };

  return (
    <Group
      gap={2}
      wrap="nowrap"
      pr={4}
      data-testid="tree-draft"
      data-entry={page ? 'file' : 'dir'}
      style={{ minWidth: 0, minHeight: touch ? layout.tapTarget : deskRowHeight, paddingLeft: depth * 14 }}
    >
      <Box w={touch ? layout.tapTarget : 22} style={{ flex: 'none' }} />
      {page ? (
        <IconFile size={iconSize} style={{ flex: 'none' }} />
      ) : (
        <IconFolder size={iconSize} style={{ flex: 'none' }} />
      )}
      <TextInput
        data-testid="tree-draft-input"
        ref={inputRef}
        autoFocus
        value={name}
        disabled={busy}
        variant="unstyled"
        size={touch ? 'md' : 'xs'}
        placeholder={page ? 'Page name' : 'Folder name'}
        aria-label={page ? 'Name of the new page' : 'Name of the new folder'}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setName(event.currentTarget.value)}
        onBlur={() => settled.current && commit()}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            cancelDraft();
          }
        }}
        styles={{ input: { fontSize: layout.inputFontSize, paddingLeft: 6, height: 'auto', minHeight: 24 } }}
        style={{ flex: '1 1 auto', minWidth: 0 }}
      />
    </Group>
  );
}

// flatten is the order the rows are in on screen, which is what a shift-click
// range means. A closed folder hides its children from it, because a range a
// reader cannot see is a range they did not choose.
function flatten(nodes: readonly NavNode[], visible: (node: NavNode) => boolean, into: string[]): string[] {
  for (const node of nodes) {
    into.push(node.path);
    if (node.is_dir && visible(node)) {
      flatten(node.children, visible, into);
    }
  }
  return into;
}

function nodeAt(nodes: readonly NavNode[], path: string): NavNode | undefined {
  for (const node of nodes) {
    if (node.path === path) {
      return node;
    }
    const found = nodeAt(node.children, path);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

export function SidebarNav(): JSX.Element {
  const navigate = useNavigate();
  const { tree, error, loading, canWrite, currentPath, query, setQuery, isOpen, openFolder } = useNav();
  const actions = useFileActions();
  const touch = useBelow(layoutBreakpoints.sidebar);
  const viewportRef = useRef<HTMLDivElement>(null);

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<string | undefined>(undefined);
  // what is being dragged cannot be read back during dragover, which is when
  // the answer is needed, so it is kept here as well as in the transfer
  const dragged = useRef<readonly string[]>([]);
  // the folder a drag is hovering over and the timer that will open it
  const spring = useRef<{ folder: string; timer: number } | undefined>(undefined);

  const trimmed = query.trim().toLowerCase();
  const filtered = useMemo(() => filterTree(tree, trimmed), [tree, trimmed]);

  const rowOrder = useMemo(
    () => flatten(tree, (node) => (trimmed === '' ? isOpen(node.path) : filtered.forcedOpen.has(node.path)), []),
    [tree, trimmed, isOpen, filtered],
  );

  // the panel starts at the top after a navigation, which on a corpus taller
  // than it leaves the page just opened somewhere off screen
  useEffect(() => {
    const viewport = viewportRef.current;
    const row = viewport?.querySelector<HTMLElement>('[data-testid="tree-row"][data-current="true"]');
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

  const pick = useCallback(
    (path: string, event: MouseEvent) => {
      // a modified click belongs to the browser: it opens the note in a tab of
      // its own, and taking it over would be worse than any selection is worth
      if (event.metaKey || event.ctrlKey) {
        return;
      }
      if (event.shiftKey) {
        event.preventDefault();
        setSelected((prev) => {
          const from = rowOrder.indexOf([...prev][prev.size - 1] ?? path);
          const to = rowOrder.indexOf(path);
          if (from < 0 || to < 0) {
            return new Set([path]);
          }
          return new Set(rowOrder.slice(Math.min(from, to), Math.max(from, to) + 1));
        });
        return;
      }
      setSelected(new Set([path]));
    },
    [rowOrder],
  );

  const canDrop = useCallback((paths: readonly string[], folder: string): boolean => {
    if (paths.length === 0) {
      return false;
    }
    return paths.every(
      (path) =>
        path !== '' &&
        parentOf(path) !== folder &&
        folder !== path &&
        !folder.startsWith(`${path}/`),
    );
  }, []);

  const startDrag = useCallback(
    (path: string, event: DragEvent) => {
      if (!canWrite || path === '') {
        event.preventDefault();
        return;
      }
      // dragging one of several picked rows takes the whole set, dragging any
      // other row is a fresh selection of one
      const paths = selected.has(path) && selected.size > 1 ? [...selected] : [path];
      if (paths.length === 1) {
        setSelected(new Set(paths));
      }
      dragged.current = paths;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', paths.map(basenameOf).join(', '));
    },
    [canWrite, selected],
  );

  const endDrag = useCallback(() => {
    dragged.current = [];
    if (spring.current !== undefined) {
      window.clearTimeout(spring.current.timer);
      spring.current = undefined;
    }
    setDropTarget(undefined);
  }, []);

  const overFolder = useCallback(
    (folder: string, event: DragEvent) => {
      if (!canDrop(dragged.current, folder)) {
        return;
      }
      // the default is "no drop here", so allowing one is an explicit refusal
      // to let the browser handle the event
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      setDropTarget(folder);
      // holding over a closed folder opens it, which is the only way to reach a
      // folder deeper in with a row already in hand
      if (spring.current?.folder !== folder) {
        if (spring.current !== undefined) {
          window.clearTimeout(spring.current.timer);
        }
        spring.current = {
          folder,
          timer: window.setTimeout(() => openFolder(folder), springOpenMs),
        };
      }
    },
    [canDrop, openFolder],
  );

  const leaveFolder = useCallback((folder: string) => {
    setDropTarget((prev) => (prev === folder ? undefined : prev));
  }, []);

  const dropOn = useCallback(
    (folder: string, event: DragEvent) => {
      const paths = dragged.current;
      endDrag();
      if (!canDrop(paths, folder)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setSelected(new Set());
      actions.moveInto(paths, folder);
    },
    [actions, canDrop, endDrag],
  );

  const ui = useMemo<TreeUi>(
    () => ({ selected, dropTarget, canWrite, pick, startDrag, endDrag, overFolder, leaveFolder, dropOn }),
    [selected, dropTarget, canWrite, pick, startDrag, endDrag, overFolder, leaveFolder, dropOn],
  );

  // where a new entry lands when the reader used the buttons rather than a row:
  // the row they picked if they picked one, otherwise the page they are on
  const at = selected.size === 1 ? ([...selected][0] ?? currentPath) : currentPath;
  const here = folderFor(at, nodeAt(tree, at)?.is_dir ?? at === '');

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
    <Stack
      data-testid="sidebar"
      gap="xs"
      h="100%"
      style={{ minWidth: 0 }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && selected.size > 0) {
          setSelected(new Set());
        }
      }}
    >
      <Box px="xs" pt="xs">
        <TextInput
          data-testid="sidebar-filter"
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
                data-testid="sidebar-filter-clear"
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

      <TreeUiContext.Provider value={ui}>
        <ScrollArea type="hover" viewportRef={viewportRef} style={{ flex: '1 1 auto', minWidth: 0 }}>
          {/* the empty space below the rows is the root folder, so dragging a
              note out of a folder needs no row to aim at */}
          <Box
            px="xs"
            pb="xs"
            mih="100%"
            data-testid="tree-root"
            data-drop={dropTarget === '' ? 'true' : 'false'}
            onDragOver={(event) => ui.overFolder('', event)}
            onDragLeave={() => ui.leaveFolder('')}
            onDrop={(event) => ui.dropOn('', event)}
            style={{
              minWidth: 0,
              borderRadius: 'var(--mantine-radius-sm)',
              outline: dropTarget === '' ? '1px solid var(--scrawl-accent)' : undefined,
              outlineOffset: -1,
            }}
          >
            {error !== undefined ? (
              <Text data-testid="sidebar-error" size="sm" c="dimmed">
                {errorText(error)}
              </Text>
            ) : loading && tree.length === 0 ? (
              <Stack data-testid="sidebar-loading" gap={6}>
                <Skeleton height={24} radius="sm" />
                <Skeleton height={24} radius="sm" />
                <Skeleton height={24} radius="sm" />
              </Stack>
            ) : trimmed !== '' && filtered.matches.length === 0 ? (
              <Text data-testid="sidebar-empty" size="sm" c="dimmed">
                Nothing matches. Press Enter to search the text of every note.
              </Text>
            ) : (
              <>
                {actions.draft?.parent === '' && <DraftRow depth={0} touch={touch} />}
                <TreeRows nodes={tree} depth={0} filtered={filtered} query={trimmed} touch={touch} />
              </>
            )}
          </Box>
        </ScrollArea>
      </TreeUiContext.Provider>

      {canWrite && (
        <Group gap="xs" px="xs" pb="xs" wrap="nowrap">
          <Button
            data-testid="sidebar-new-page"
            variant="default"
            size={touch ? 'sm' : 'xs'}
            leftSection={<IconPlus size={14} />}
            onClick={() => actions.createPage(here)}
            style={{ flex: '1 1 0', minWidth: 0 }}
          >
            New page
          </Button>
          <Button
            data-testid="sidebar-new-folder"
            variant="default"
            size={touch ? 'sm' : 'xs'}
            leftSection={<IconFolderPlus size={14} />}
            onClick={() => actions.createFolder(here)}
            style={{ flex: '1 1 0', minWidth: 0 }}
          >
            New folder
          </Button>
        </Group>
      )}
    </Stack>
  );
}
