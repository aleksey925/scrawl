import {
  ActionIcon, Anchor, Box, Group, Highlight, Menu, ScrollArea, Skeleton, Stack, Text, TextInput,
} from '@mantine/core';
import {
  IconFile, IconFilePlus, IconFolder, IconFolderOpen, IconFolderPlus, IconPlus, IconSearch, IconX,
} from '@tabler/icons-react';
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type CSSProperties, type DragEvent, type JSX, type KeyboardEvent, type MouseEvent, type ReactNode,
} from 'react';
import { Link, useNavigate } from 'react-router';

import type { NavNode } from '../api/types';
import { errorText } from '../api/useApi';
import controls from '../controls.module.css';
import { usePlatform } from '../platform';
import { iconEdgeInset, layout, layoutBreakpoints, useBelow } from '../theme';

import { rowMenuIconSize, useReaderExtensions } from './extensions';
import { useFileActions, useOptionalFileActions } from './fileActionsContext';
import { useNav } from './NavContext';
import { SyncBadge } from './SyncBadge';
import { basenameOf, folderFor, parentOf } from './naming';
import treeClasses from './Tree.module.css';
import { filterTree, type FilteredTree } from './treeFilter';
import { useLongPress } from './useLongPress';

const iconSize = 16;
const deskRowHeight = 32;
// the box an entry's icon sits in, which for a folder is the button that
// opens and closes it
const deskIconBox = 22;
const touchIconBox = 28;
const indentStep = 18;

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
  const draft = useOptionalFileActions()?.draft;
  const { RowMenu } = useReaderExtensions();
  const ui = useTreeUi();
  const [menuOpened, setMenuOpened] = useState(false);
  const openMenu = useCallback(() => setMenuOpened(true), []);
  const longPress = useLongPress(openMenu);

  // the space's own row: it is the folder everything else grows out of, so a
  // filter never hides it and nothing may drag it anywhere
  const root = node.path === '';

  if (!root && query !== '' && !filtered.visible.has(node.path)) {
    return null;
  }

  const open = query !== '' ? root || filtered.forcedOpen.has(node.path) : isOpen(node.path);
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
        gap={4}
        wrap="nowrap"
        data-testid="tree-row"
        className={RowMenu === undefined ? treeClasses.row : `${treeClasses.row} ${treeClasses.pressable}`}
        data-current={current ? 'true' : 'false'}
        data-selected={picked ? 'true' : 'false'}
        data-drop={over ? 'true' : 'false'}
        data-dir={node.is_dir ? 'true' : 'false'}
        data-path={node.path}
        draggable={ui.canWrite && !root}
        onDragStart={(event) => ui.startDrag(node.path, event)}
        onDragEnd={ui.endDrag}
        onDragOver={(event) => ui.overFolder(folderFor(node.path, node.is_dir), event)}
        onDragLeave={() => ui.leaveFolder(folderFor(node.path, node.is_dir))}
        onDrop={(event) => ui.dropOn(folderFor(node.path, node.is_dir), event)}
        // the row's menu is its context menu too, and a site, which has no
        // menu to offer, leaves the browser's own in place
        {...(RowMenu === undefined
          ? {}
          : {
              ...longPress,
              onContextMenu: (event: MouseEvent) => {
                event.preventDefault();
                openMenu();
              },
            })}
        style={{
          minWidth: 0,
          minHeight: touch ? layout.tapTarget : deskRowHeight,
          ...rowInsets(depth, touch),
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
            size={touch ? touchIconBox : 'sm'}
            className={touch ? controls.twisty : undefined}
            style={{ flex: 'none' }}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${node.name}`}
            aria-expanded={open}
            onClick={() => toggleFolder(node.path)}
          >
            {open ? <IconFolderOpen size={iconSize} /> : <IconFolder size={iconSize} />}
          </ActionIcon>
        ) : (
          <EntryIcon touch={touch}>
            <IconFile size={iconSize} />
          </EntryIcon>
        )}

        <Anchor
          data-testid="tree-link"
          component={Link}
          to={node.url}
          underline="never"
          draggable={false}
          aria-current={current ? 'page' : undefined}
          // a folder's label opens its page unfolded, and on that page folds
          // and unfolds it; a filter holds open what matched, so there it is a link
          onClick={(event: MouseEvent) => {
            ui.pick(node.path, event);
            if (!node.is_dir || query !== '' || event.defaultPrevented || event.metaKey || event.ctrlKey) {
              return;
            }
            if (current) {
              event.preventDefault();
              toggleFolder(node.path);
              return;
            }
            openFolder(node.path);
          }}
          style={{ flex: '1 1 auto', minWidth: 0, color: 'inherit' }}
        >
          <Highlight
            size="sm"
            truncate
            highlight={query === '' ? [] : query}
            fw={current ? 600 : undefined}
            c={current ? 'var(--scrawl-accent)' : undefined}
            style={{ minWidth: 0 }}
          >
            {node.name}
          </Highlight>
        </Anchor>

        {/* outside the link, so the link's accessible name stays the note's
            name and the badge reads beside it */}
        <SyncBadge path={node.path} />

        {RowMenu !== undefined && (
          <RowMenu
            path={node.path}
            isDir={node.is_dir}
            name={node.name}
            touch={touch}
            opened={menuOpened}
            onOpenedChange={setMenuOpened}
          />
        )}
      </Group>

      {node.is_dir && open && (
        // the space's own row holds everything, and a line beside every row
        // of the tree would say nothing
        <div
          data-testid="tree-children"
          className={root ? undefined : treeClasses.children}
          style={root ? undefined : ({ '--tree-guide-x': guideX(depth, touch) } as CSSProperties)}
        >
          {drafting && <DraftRow depth={depth + 1} touch={touch} />}
          {!drafting && node.children.length === 0 && <EmptyRow depth={depth + 1} touch={touch} />}
          {node.children.length > 0 && (
            <TreeRows nodes={node.children} depth={depth + 1} filtered={filtered} query={query} touch={touch} />
          )}
        </div>
      )}
    </Box>
  );
}

// EntryIcon holds the icon of a row that is not a folder's button, in a box
// of the same width, so every icon of one depth stands in one column
function EntryIcon({ touch, children }: { touch: boolean; children?: ReactNode }): JSX.Element {
  return (
    <Box
      w={touch ? touchIconBox : deskIconBox}
      style={{ flex: 'none', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
    >
      {children}
    </Box>
  );
}

// the glyph of the icon, not its box, starts on the phone's 16px line
const touchIconOffset = (touchIconBox - iconSize) / 2;

// on a phone a row runs from edge to edge, so its highlight has no edge of its
// own to sit off the line the icon, the menu glyph and the page text share
function rowInsets(depth: number, touch: boolean): CSSProperties {
  if (!touch) {
    return { paddingLeft: depth * indentStep, paddingRight: 4, borderRadius: 'var(--mantine-radius-md)' };
  }
  return {
    paddingLeft: `calc(var(--mantine-spacing-lg) - ${touchIconOffset}px + ${depth * indentStep}px)`,
    paddingRight: iconEdgeInset(rowMenuIconSize),
  };
}

// guideX is the middle of the icon of a folder at this depth, where the line
// its open rows hang off is drawn
function guideX(depth: number, touch: boolean): string {
  if (!touch) {
    return `${depth * indentStep + deskIconBox / 2}px`;
  }
  return `calc(var(--mantine-spacing-lg) - ${touchIconOffset}px + ${depth * indentStep + touchIconBox / 2}px)`;
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

function EmptyRow({ depth, touch }: { depth: number; touch: boolean }): JSX.Element {
  return (
    <Group
      gap={4}
      wrap="nowrap"
      data-testid="tree-empty"
      style={{ minWidth: 0, minHeight: touch ? layout.tapTarget : deskRowHeight, ...rowInsets(depth, touch) }}
    >
      <EntryIcon touch={touch} />
      <Text size="sm" c="dimmed" fs="italic">
        No notes here
      </Text>
    </Group>
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
      gap={4}
      wrap="nowrap"
      data-testid="tree-draft"
      data-entry={page ? 'file' : 'dir'}
      style={{ minWidth: 0, minHeight: touch ? layout.tapTarget : deskRowHeight, ...rowInsets(depth, touch) }}
    >
      <EntryIcon touch={touch}>
        {page ? <IconFile size={iconSize} /> : <IconFolder size={iconSize} />}
      </EntryIcon>
      <TextInput
        data-testid="tree-draft-input"
        ref={inputRef}
        autoFocus
        value={name}
        disabled={busy}
        variant="unstyled"
        size={touch ? 'md' : 'sm'}
        placeholder={page ? 'File name' : 'Folder name'}
        aria-label={page ? 'Name of the new file' : 'Name of the new folder'}
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
        styles={{ input: { paddingLeft: 6, height: 'auto', minHeight: 24 } }}
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

function inFolder(folder: string, space: string): string {
  return `In ${folder === '' ? space : folder}`;
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
  const { tree, error, loading, canWrite: mayWrite, currentPath, query, setQuery, isOpen, openFolder, me } = useNav();
  const actions = useOptionalFileActions();
  const { search } = usePlatform();
  // a reader with nowhere to write offers no write, whatever the space allows
  const canWrite = mayWrite && actions !== undefined;
  const touch = useBelow(layoutBreakpoints.sidebar);
  // the drawer leaves its sides to this: its rows reach both edges and carry
  // their own insets, so the chevron's touch strip on a top-level row is whole
  const gutter = touch ? 'lg' : 'md';
  const viewportRef = useRef<HTMLDivElement>(null);

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // the pick follows the page: a row picked before a navigation would still be
  // where the next new entry lands, though the page has moved on from it
  useEffect(() => setSelected(new Set([currentPath])), [currentPath]);
  const [dropTarget, setDropTarget] = useState<string | undefined>(undefined);
  // what is being dragged cannot be read back during dragover, which is when
  // the answer is needed, so it is kept here as well as in the transfer
  const dragged = useRef<readonly string[]>([]);
  // the folder a drag is hovering over and the timer that will open it
  const spring = useRef<{ folder: string; timer: number } | undefined>(undefined);

  const trimmed = query.trim().toLowerCase();
  const filtered = useMemo(() => filterTree(tree, trimmed), [tree, trimmed]);

  // the space is a row like any other, and everything grows out of it. It is
  // what makes the root reachable at all: without it there is nothing to point
  // at when a new page belongs beside the folders rather than inside one.
  const rootNode = useMemo<NavNode>(
    () => ({
      name: me?.space.label ?? me?.site_title ?? 'Notes',
      path: '',
      url: '/',
      is_dir: true,
      active: true,
      current: false,
      children: [...tree],
    }),
    [me?.space.label, me?.site_title, tree],
  );

  const rowOrder = useMemo(
    () => flatten([rootNode], (node) => (trimmed === '' ? isOpen(node.path) : true), []),
    [rootNode, trimmed, isOpen],
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
      actions?.moveInto(paths, folder);
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
      if (first !== undefined) {
        void navigate(first.url);
      } else if (search) {
        void navigate(`/search?q=${encodeURIComponent(query.trim())}`);
      }
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
      <Group gap="xs" px={gutter} pt="xs" wrap="nowrap">
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
          style={{ flex: '1 1 auto', minWidth: 0 }}
        />
        {canWrite && actions !== undefined && (
          <Menu position="bottom-end" withinPortal shadow="md" width={200}>
            <Menu.Target>
              <ActionIcon
                data-testid="sidebar-new"
                variant="default"
                size={touch ? layout.tapTarget : layout.controlHeight}
                style={{ flex: 'none' }}
                aria-label="New file or folder"
              >
                <IconPlus size={iconSize} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {/* where it lands is the row that is picked, and the label says
                  so for the times the tree is scrolled away from it */}
              <Menu.Label data-testid="sidebar-new-where">{inFolder(here, rootNode.name)}</Menu.Label>
              <Menu.Item
                data-testid="sidebar-new-page"
                leftSection={<IconFilePlus size={iconSize} />}
                onClick={() => actions.createPage(here)}
              >
                New file
              </Menu.Item>
              <Menu.Item
                data-testid="sidebar-new-folder"
                leftSection={<IconFolderPlus size={iconSize} />}
                onClick={() => actions.createFolder(here)}
              >
                New folder
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>

      <TreeUiContext.Provider value={ui}>
        <ScrollArea type="hover" viewportRef={viewportRef} style={{ flex: '1 1 auto', minWidth: 0 }}>
          {/* the empty space below the rows is the root folder, so dragging a
              note out of a folder needs no row to aim at */}
          <Box
            px={touch ? 0 : gutter}
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
                {search ? 'Nothing matches. Press Enter to search the text of every note.' : 'Nothing matches.'}
              </Text>
            ) : (
              <TreeRows nodes={[rootNode]} depth={0} filtered={filtered} query={trimmed} touch={touch} />
            )}
          </Box>
        </ScrollArea>
      </TreeUiContext.Provider>
    </Stack>
  );
}
