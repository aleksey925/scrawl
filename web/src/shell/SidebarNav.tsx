import {
  ActionIcon, Anchor, Box, Group, Highlight, Menu, ScrollArea, Skeleton, Stack, Text, TextInput, UnstyledButton,
} from '@mantine/core';
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type CSSProperties, type DragEvent, type JSX, type KeyboardEvent, type MouseEvent, type ReactNode,
} from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

import type { NavNode } from '../api/types';
import { errorText } from '../api/useApi';
import { PopupMenu } from '../components/PopupMenu';
import {
  IconChevronDown, IconChevronRight, IconChevronsLeft, IconFile, IconFilePlus, IconFileText, IconFolder, IconFolderOpen,
  IconFolderPlus, IconHome, IconPlus, IconSearch, IconNotePencil, IconX,
} from '../icons';
import { editUrl } from '../paths';
import { layout } from '../theme';

import { rowMenuIconSize, useReaderExtensions } from './extensions';
import { useFileActions, useOptionalFileActions } from './fileActionsContext';
import { spaceLabel, useNav } from './NavContext';
import { basenameOf, folderFor, pageName, parentOf } from './naming';
import { useSearchOpener } from './searchOpener';
import sidebarClasses from './Sidebar.module.css';
import { SyncBadge } from './SyncBadge';
import treeClasses from './Tree.module.css';
import { filterTree, type FilteredTree } from './treeFilter';
import { useLongPress } from './useLongPress';

const treeIconSize = 18;
// the box an entry's icon sits in, which for a folder is the button that
// opens and closes it
const iconBox = 22;
const indentStep = 14;
// the room before a top-level row's icon, inside the row's own corners
const rowStart = 6;

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
}

type TreeRowProps = Omit<RowsProps, 'nodes'> & { node: NavNode };

function TreeRow({ node, depth, filtered, query }: TreeRowProps): JSX.Element | null {
  const { isOpen, openFolder, toggleFolder, currentPath, canWrite } = useNav();
  const actions = useOptionalFileActions();
  const draft = actions?.draft;
  const { RowMenu } = useReaderExtensions();
  const ui = useTreeUi();
  const [menuOpened, setMenuOpened] = useState(false);
  const openMenu = useCallback(() => setMenuOpened(true), []);
  const longPress = useLongPress(openMenu);

  if (query !== '' && !filtered.visible.has(node.path)) {
    return null;
  }

  const open = query !== '' ? filtered.forcedOpen.has(node.path) : isOpen(node.path);
  // the route decides this and not the answer the server sent with the tree:
  // the click has already happened, and a highlight that waits for a round trip
  // is a click that did nothing for as long as the round trip took
  const current = node.path === currentPath;
  const picked = ui.selected.has(node.path);
  const over = ui.dropTarget === node.path;
  const drafting = draft !== undefined && draft.parent === node.path;

  return (
    <Box style={{ minWidth: 0 }}>
      <div
        data-testid="tree-row"
        className={RowMenu === undefined ? treeClasses.row : `${treeClasses.row} ${treeClasses.pressable}`}
        data-current={current ? 'true' : 'false'}
        data-selected={picked ? 'true' : 'false'}
        data-drop={over ? 'true' : 'false'}
        data-dir={node.is_dir ? 'true' : 'false'}
        data-menu={menuOpened ? 'true' : 'false'}
        data-path={node.path}
        draggable={ui.canWrite}
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
        style={rowInsets(depth)}
      >
        {node.is_dir ? (
          <ActionIcon
            data-testid="tree-twisty"
            data-open={open ? 'true' : 'false'}
            variant="subtle"
            color="gray"
            size={iconBox}
            className={treeClasses.icon}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${node.name}`}
            aria-expanded={open}
            onClick={() => toggleFolder(node.path)}
          >
            {open ? (
              <IconFolderOpen size={treeIconSize} className={treeClasses.glyph} />
            ) : (
              <IconFolder size={treeIconSize} className={treeClasses.glyph} />
            )}
            {open ? (
              <IconChevronDown size={treeIconSize} className={treeClasses.chevron} />
            ) : (
              <IconChevronRight size={treeIconSize} className={treeClasses.chevron} />
            )}
          </ActionIcon>
        ) : (
          <IconBox>
            <IconFileText size={treeIconSize} />
          </IconBox>
        )}

        <Anchor
          data-testid="tree-link"
          component={Link}
          to={node.url}
          underline="never"
          draggable={false}
          aria-current={current ? 'page' : undefined}
          className={treeClasses.label}
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
        >
          <Highlight size="sm" truncate highlight={query === '' ? [] : query} fw="inherit" style={{ minWidth: 0 }}>
            {pageName(node.name, node.is_dir)}
          </Highlight>
        </Anchor>

        {/* outside the link, so the link's accessible name stays the note's
            name and the badge reads beside it */}
        <SyncBadge path={node.path} />

        {RowMenu !== undefined && (
          <div className={treeClasses.tools}>
            <RowMenu
              path={node.path}
              isDir={node.is_dir}
              name={node.name}
              touch={false}
              editUrl={node.is_dir ? undefined : editUrl(node.path)}
              opened={menuOpened}
              onOpenedChange={setMenuOpened}
            />
            {node.is_dir && canWrite && actions !== undefined && (
              <ActionIcon
                data-testid="tree-row-add"
                variant="subtle"
                color="gray"
                size="sm"
                className={treeClasses.add}
                aria-label={`New file in ${node.name}`}
                onClick={() => {
                  openFolder(node.path);
                  actions.createPage(node.path);
                }}
              >
                <IconPlus size={rowMenuIconSize} />
              </ActionIcon>
            )}
          </div>
        )}
      </div>

      {node.is_dir && open && (
        <div data-testid="tree-children">
          {drafting && <DraftRow depth={depth + 1} />}
          {!drafting && node.children.length === 0 && <EmptyRow depth={depth + 1} />}
          {node.children.length > 0 && (
            <TreeRows nodes={node.children} depth={depth + 1} filtered={filtered} query={query} />
          )}
        </div>
      )}
    </Box>
  );
}

// IconBox holds the icon of a row that is not a folder's button, in a box of
// the same width, so every icon of one depth stands in one column
function IconBox({ children }: { children?: ReactNode }): JSX.Element {
  return (
    <Box
      w={iconBox}
      className={treeClasses.icon}
      style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}
    >
      {children}
    </Box>
  );
}

function rowInsets(depth: number): CSSProperties {
  return { marginInline: 8, paddingLeft: rowStart + depth * indentStep, paddingRight: 4 };
}

function TreeRows({ nodes, depth, filtered, query }: RowsProps): JSX.Element {
  return (
    <>
      {nodes.map((child) => (
        <TreeRow key={child.path} node={child} depth={depth} filtered={filtered} query={query} />
      ))}
    </>
  );
}

function EmptyRow({ depth }: { depth: number }): JSX.Element {
  return (
    <div
      data-testid="tree-empty"
      className={`${treeClasses.row} ${treeClasses.none}`}
      style={rowInsets(depth)}
    >
      <IconBox />
      <Text span inherit>
        No notes inside
      </Text>
    </div>
  );
}

// DraftRow is the new entry before it exists. Enter creates it, Escape drops
// it, and leaving the field does too: an input the reader walked away from is
// not a file they asked for.
function DraftRow({ depth }: { depth: number }): JSX.Element {
  const { draft, submitDraft, cancelDraft } = useFileActions();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // a menu item is one of the ways this row is opened, and mantine's menu hands
  // focus back to the button it closed under - a tick after this row mounted
  // and took it. Until the dust settles a blur says nothing about the reader.
  const settled = useRef(false);
  const isFile = draft?.kind === 'file';

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
      gap={6}
      wrap="nowrap"
      data-testid="tree-draft"
      data-entry={isFile ? 'file' : 'dir'}
      className={`${treeClasses.row} ${treeClasses.draft}`}
      style={rowInsets(depth)}
    >
      <IconBox>{isFile ? <IconFile size={treeIconSize} /> : <IconFolder size={treeIconSize} />}</IconBox>
      <TextInput
        data-testid="tree-draft-input"
        ref={inputRef}
        autoFocus
        value={name}
        disabled={busy}
        variant="unstyled"
        size="sm"
        placeholder={isFile ? 'File name' : 'Folder name'}
        aria-label={isFile ? 'Name of the new file' : 'Name of the new folder'}
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
        styles={{ input: { height: 'auto', minHeight: 24 } }}
        style={{ flex: '1 1 auto', minWidth: 0 }}
      />
    </Group>
  );
}

// flatten is the order the rows are in on screen, which is what a shift-click
// range means. A closed folder hides its children from it, because a range a
// reader cannot see is a range they did not choose.
function flatten(nodes: readonly NavNode[], visible: (node: NavNode) => boolean, into: string[]): string[] {
  for (const entry of nodes) {
    into.push(entry.path);
    if (entry.is_dir && visible(entry)) {
      flatten(entry.children, visible, into);
    }
  }
  return into;
}

// the routes that show the root's list; every other route outside a path,
// search or recent among them, has an empty content path too
const rootListRoutes = new Set(['/', '/doc', '/doc/']);

function inFolder(folder: string, space: string): string {
  return `In ${folder === '' ? space : folder}`;
}

function nodeAt(nodes: readonly NavNode[], path: string): NavNode | undefined {
  for (const entry of nodes) {
    if (entry.path === path) {
      return entry;
    }
    const found = nodeAt(entry.children, path);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

export interface SidebarNavProps {
  head?: ReactNode;
  onHide?: () => void;
}

export function SidebarNav({ head, onHide }: SidebarNavProps): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const { tree, error, loading, canWrite: mayWrite, currentPath, query, setQuery, isOpen, openFolder, me } = useNav();
  const actions = useOptionalFileActions();
  const openSearch = useSearchOpener();
  // a reader with nowhere to write offers no write, whatever the space allows
  const canWrite = mayWrite && actions !== undefined;
  const viewportRef = useRef<HTMLDivElement>(null);
  const spaceName = spaceLabel(me);

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

  const rowOrder = useMemo(
    () => flatten(tree, (node) => (trimmed === '' ? isOpen(node.path) : true), []),
    [tree, trimmed, isOpen],
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
      (moved) => moved !== '' && parentOf(moved) !== folder && folder !== moved && !folder.startsWith(`${moved}/`),
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

  const stopSpring = useCallback(() => {
    if (spring.current !== undefined) {
      window.clearTimeout(spring.current.timer);
      spring.current = undefined;
    }
  }, []);
  // the sidebar can be put away in the middle of a drag, and the timer would
  // still open a folder
  useEffect(() => stopSpring, [stopSpring]);

  const endDrag = useCallback(() => {
    dragged.current = [];
    stopSpring();
    setDropTarget(undefined);
  }, [stopSpring]);

  const overFolder = useCallback(
    (folder: string, event: DragEvent) => {
      if (!canDrop(dragged.current, folder)) {
        stopSpring();
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
      if (folder === '') {
        stopSpring();
      } else if (spring.current?.folder !== folder) {
        stopSpring();
        spring.current = {
          folder,
          timer: window.setTimeout(() => openFolder(folder), springOpenMs),
        };
      }
    },
    [canDrop, openFolder, stopSpring],
  );

  const leaveFolder = useCallback(
    (folder: string) => {
      if (spring.current?.folder === folder) {
        stopSpring();
      }
      setDropTarget((prev) => (prev === folder ? undefined : prev));
    },
    [stopSpring],
  );

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
  const draftAtRoot = actions?.draft !== undefined && actions.draft.parent === '';
  const home = tree.find((node) => node.folder_page === true);
  const atHome = home !== undefined ? currentPath === home.path : rootListRoutes.has(location.pathname);

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
      } else if (openSearch !== undefined) {
        openSearch(query.trim());
      }
      return;
    }
    if (event.key === 'Escape' && query !== '') {
      event.stopPropagation();
      setQuery('');
    }
  }

  const rootDrop = {
    onDragOver: (event: DragEvent) => ui.overFolder('', event),
    onDragLeave: () => ui.leaveFolder(''),
    onDrop: (event: DragEvent) => ui.dropOn('', event),
  };

  return (
    <div
      data-testid="sidebar"
      className={sidebarClasses.sidebar}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && selected.size > 0) {
          setSelected(new Set());
        }
      }}
    >
      {(head !== undefined || onHide !== undefined || canWrite) && (
        <div className={sidebarClasses.head}>
          {head}
          {onHide !== undefined && (
            <ActionIcon
              data-testid="sidebar-hide"
              variant="subtle"
              color="gray"
              className={sidebarClasses.hide}
              aria-label="Hide the sidebar"
              onClick={onHide}
            >
              <IconChevronsLeft size={layout.iconSize} />
            </ActionIcon>
          )}
          {canWrite && actions !== undefined && (
            <PopupMenu position="bottom-end" withinPortal width={layout.menuWidth}>
              <Menu.Target>
                <ActionIcon
                  data-testid="sidebar-new"
                  variant="subtle"
                  color="gray"
                  size={layout.controlHeight}
                  aria-label="New file or folder"
                >
                  <IconNotePencil size={layout.iconSize} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                {/* where it lands is the row that is picked, and the label says
                    so for the times the tree is scrolled away from it */}
                <Menu.Label data-testid="sidebar-new-where">{inFolder(here, spaceName)}</Menu.Label>
                <Menu.Item
                  data-testid="sidebar-new-page"
                  leftSection={<IconFilePlus size={layout.iconSizeSmall} />}
                  onClick={() => actions.createPage(here)}
                >
                  New file
                </Menu.Item>
                <Menu.Item
                  data-testid="sidebar-new-folder"
                  leftSection={<IconFolderPlus size={layout.iconSizeSmall} />}
                  onClick={() => actions.createFolder(here)}
                >
                  New folder
                </Menu.Item>
              </Menu.Dropdown>
            </PopupMenu>
          )}
        </div>
      )}

      <div className={sidebarClasses.top}>
        {openSearch !== undefined && (
          <UnstyledButton data-testid="sidebar-search" className={sidebarClasses.navRow} onClick={() => openSearch()}>
            <IconSearch size={layout.iconSizeSmall} />
            <span>Search</span>
          </UnstyledButton>
        )}
        <Link
          data-testid="sidebar-home"
          to={home?.url ?? '/'}
          className={sidebarClasses.navRow}
          data-current={atHome ? 'true' : 'false'}
          aria-current={atHome ? 'page' : undefined}
        >
          <IconHome size={layout.iconSizeSmall} />
          <span>Home</span>
        </Link>
      </div>

      {/* the label is the root folder: it opens the root's list and takes a
          drop, so dragging a note out of a folder needs no row to aim at */}
      <div
        data-testid="sidebar-section"
        className={sidebarClasses.section}
        data-drop={dropTarget === '' ? 'true' : 'false'}
        {...rootDrop}
      >
        <Link to="/" className={sidebarClasses.sectionLabel}>
          Notes
        </Link>
        {canWrite && actions !== undefined && (
          <div className={sidebarClasses.sectionTools}>
            <ActionIcon
              data-testid="sidebar-section-new"
              variant="subtle"
              color="gray"
              size="sm"
              aria-label={`New file in ${spaceName}`}
              onClick={() => actions.createPage('')}
            >
              <IconPlus size={rowMenuIconSize} />
            </ActionIcon>
          </div>
        )}
      </div>

      <div className={sidebarClasses.filter}>
        <TextInput
          data-testid="sidebar-filter"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={onFilterKey}
          placeholder="Filter notes"
          aria-label="Filter notes"
          size="sm"
          leftSection={<IconSearch size={treeIconSize} />}
          rightSectionPointerEvents="all"
          rightSection={
            query === '' ? null : (
              // a touch keyboard has no Escape, so on a tablet this is the
              // only way out of a query
              <ActionIcon
                data-testid="sidebar-filter-clear"
                variant="subtle"
                color="gray"
                size="sm"
                aria-label="Clear the filter"
                onClick={() => setQuery('')}
              >
                <IconX size={layout.iconSizeTiny} />
              </ActionIcon>
            )
          }
        />
      </div>

      <TreeUiContext.Provider value={ui}>
        <ScrollArea type="hover" viewportRef={viewportRef} style={{ flex: '1 1 auto', minWidth: 0 }}>
          <Stack
            gap={1}
            pb="md"
            mih="100%"
            data-testid="tree-root"
            data-drop={dropTarget === '' ? 'true' : 'false'}
            {...rootDrop}
            style={{ minWidth: 0 }}
          >
            {error !== undefined ? (
              <Text data-testid="sidebar-error" size="sm" c="dimmed" px="md">
                {errorText(error)}
              </Text>
            ) : loading && tree.length === 0 ? (
              <Stack data-testid="sidebar-loading" gap={6} px="md">
                <Skeleton height={22} radius="sm" />
                <Skeleton height={22} radius="sm" />
                <Skeleton height={22} radius="sm" />
              </Stack>
            ) : trimmed !== '' && filtered.matches.length === 0 ? (
              <Text data-testid="sidebar-empty" size="sm" c="dimmed" px="md">
                {openSearch !== undefined ? 'Nothing matches. Press Enter to search the text of every note.' : 'Nothing matches.'}
              </Text>
            ) : (
              <>
                {draftAtRoot && <DraftRow depth={0} />}
                {!draftAtRoot && tree.length === 0 && <EmptyRow depth={0} />}
                <TreeRows nodes={tree} depth={0} filtered={filtered} query={trimmed} />
              </>
            )}
          </Stack>
        </ScrollArea>
      </TreeUiContext.Provider>
    </div>
  );
}
