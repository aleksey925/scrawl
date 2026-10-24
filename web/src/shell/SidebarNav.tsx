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
  IconChevronDown, IconChevronRight, IconCompose, IconFile, IconFilePlus, IconFileText, IconFolder, IconFolderOpen,
  IconFolderPlus, IconHome, IconPlus, IconSearch, IconSidebar, IconX,
} from '../icons';
import { editUrl } from '../paths';
import { layout } from '../theme';

import { rowMenuIconSize, useReaderExtensions } from './extensions';
import { useFileActions, useOptionalFileActions } from './fileActionsContext';
import { spaceLabel, useNav } from './NavContext';
import { basenameOf, folderFor, pageName, parentOf } from './naming';
import { useSearchControl } from './searchOpener';
import { keysLabel, modKey, useKeyboardPlace } from './shortcuts';
import sidebarClasses from './Sidebar.module.css';
import { SyncBadge } from './SyncBadge';
import treeClasses from './Tree.module.css';
import { filterTree, type FilteredTree } from './treeFilter';
import { useLongPress } from './useLongPress';

const treeIconSize = 18;
const iconBox = 22;
const indentStep = 14;
const rowStart = 6;

const focusSettleMs = 150;

const springOpenMs = 600;

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

function DraftRow({ depth }: { depth: number }): JSX.Element {
  const { draft, submitDraft, cancelDraft } = useFileActions();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
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

function flatten(nodes: readonly NavNode[], visible: (node: NavNode) => boolean, into: string[]): string[] {
  for (const entry of nodes) {
    into.push(entry.path);
    if (entry.is_dir && visible(entry)) {
      flatten(entry.children, visible, into);
    }
  }
  return into;
}

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
  foot?: ReactNode;
  onHide?: () => void;
}

export function SidebarNav({ foot, onHide }: SidebarNavProps): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const { tree, error, loading, canWrite: mayWrite, currentPath, query, setQuery, isOpen, openFolder, me } = useNav();
  const actions = useOptionalFileActions();
  const openSearch = useSearchControl()?.open;
  const keyboard = useKeyboardPlace();
  const canWrite = mayWrite && actions !== undefined;
  const viewportRef = useRef<HTMLDivElement>(null);
  const spaceName = spaceLabel(me);

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => setSelected(new Set([currentPath])), [currentPath]);
  const [dropTarget, setDropTarget] = useState<string | undefined>(undefined);
  const dragged = useRef<readonly string[]>([]);
  const spring = useRef<{ folder: string; timer: number } | undefined>(undefined);

  const trimmed = query.trim().toLowerCase();
  const filtered = useMemo(() => filterTree(tree, trimmed), [tree, trimmed]);

  const rowOrder = useMemo(
    () => flatten(tree, (node) => (trimmed === '' ? isOpen(node.path) : true), []),
    [tree, trimmed, isOpen],
  );

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
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      setDropTarget(folder);
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
      {(onHide !== undefined || canWrite) && (
        <div className={sidebarClasses.head}>
          {onHide !== undefined && (
            <ActionIcon
              data-testid="sidebar-hide"
              variant="subtle"
              color="gray"
              size={layout.controlHeight}
              aria-label="Hide the sidebar"
              onClick={onHide}
            >
              <IconSidebar size={layout.iconSize} />
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
                  className={sidebarClasses.compose}
                  aria-label="New file or folder"
                >
                  <IconCompose size={layout.iconSize} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
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
            {keyboard && (
              <span data-testid="sidebar-search-keys" className={sidebarClasses.navKeys}>
                {keysLabel(modKey, 'K')}
              </span>
            )}
          </UnstyledButton>
        )}
        <Link
          data-testid="sidebar-home"
          to={home?.url ?? '/'}
          className={`${sidebarClasses.navRow} ${sidebarClasses.homeRow}`}
          data-current={atHome ? 'true' : 'false'}
          aria-current={atHome ? 'page' : undefined}
        >
          <IconHome size={layout.iconSizeSmall} />
          <span>Home</span>
        </Link>
      </div>

      <div
        data-testid="sidebar-section"
        className={sidebarClasses.section}
        data-drop={dropTarget === '' ? 'true' : 'false'}
        {...rootDrop}
      >
        <Link to="/" data-testid="sidebar-section-label" className={sidebarClasses.sectionLabel}>
          {spaceName}
        </Link>
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

      {foot !== undefined && <div className={sidebarClasses.foot}>{foot}</div>}
    </div>
  );
}
