import {
  ActionIcon, Anchor, Box, Group, Highlight, ScrollArea, Skeleton, Stack, Text, TextInput, UnstyledButton,
} from '@mantine/core';
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type CSSProperties, type DragEvent, type JSX, type KeyboardEvent, type MouseEvent, type ReactNode,
} from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

import type { NavNode } from '../api/types';
import { errorText } from '../api/useApi';
import { NameField } from '../components/NameField';
import { NewEntryMenu, usePointerMenu } from '../components/pointerMenu';
import { RenameField } from '../components/RenameField';
import {
  IconChevronDown, IconChevronRight, IconCompose, IconFileText, IconFolder, IconFolderOpen,
  IconHome, IconPlus, IconSearch, IconSidebar, IconX,
} from '../icons';
import { editUrl, isDirectoryPath, isMarkdown } from '../paths';
import { layout } from '../theme';

import { rowMenuIconSize, useReaderExtensions } from './extensions';
import { useFileActions, useOptionalFileActions, useRenamingHere, type Renaming } from './fileActionsContext';
import { spaceLabel, useNav } from './NavContext';
import { basenameOf, folderFor, parentOf } from './naming';
import { useShownChrome } from './PageChrome';
import { useSearchControl } from './searchOpener';
import { keysLabel, modKey, useKeyboardPlace } from './shortcuts';
import sidebarClasses from './Sidebar.module.css';
import { SyncBadge } from './SyncBadge';
import treeClasses from './Tree.module.css';
import { filterTree, nodeAt, type FilteredTree } from './treeFilter';
import { useLongPress } from './useLongPress';

const treeIconSize = 18;
const iconBox = 22;
const indentStep = 14;
const rowStart = 6;

const springOpenMs = 600;

interface TreeUi {
  currentRow: string;
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
  const renaming = useRenamingHere('tree', node.path);
  const ghost = useGhostIn(node.path, query);
  const empty = node.is_dir && node.children.length === 0;

  if (query !== '' && !filtered.visible.has(node.path)) {
    return null;
  }

  const drafting = draft !== undefined && draft.parent === node.path;
  const unfolded = query !== '' ? filtered.forcedOpen.has(node.path) : isOpen(node.path);
  const added = drafting || ghost !== undefined;
  const open = empty ? added : unfolded;
  const folderOpen = empty ? isOpen(node.path) || added : unfolded;
  const shown = node.path === currentPath;
  const marked = node.path === ui.currentRow;
  const picked = ui.selected.has(node.path);
  const over = ui.dropTarget === node.path;

  return (
    <Box style={{ minWidth: 0 }}>
      {renaming !== undefined ? (
        <RenameRow session={renaming} depth={depth} />
      ) : (
        <div
          data-testid="tree-row"
          className={RowMenu === undefined ? treeClasses.row : `${treeClasses.row} ${treeClasses.pressable}`}
          data-current={marked ? 'true' : 'false'}
          data-selected={picked ? 'true' : 'false'}
          data-drop={over ? 'true' : 'false'}
          data-dir={node.is_dir ? 'true' : 'false'}
          data-empty={empty ? 'true' : 'false'}
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
            <FolderIcon name={node.name} empty={empty} open={folderOpen} onToggle={() => toggleFolder(node.path)} />
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
            aria-current={shown ? 'page' : undefined}
            className={treeClasses.label}
            onClick={(event: MouseEvent) => {
              ui.pick(node.path, event);
              if (!node.is_dir || query !== '' || event.defaultPrevented || event.metaKey || event.ctrlKey) {
                return;
              }
              if (shown) {
                event.preventDefault();
                toggleFolder(node.path);
                return;
              }
              openFolder(node.path);
            }}
          >
            <Highlight size="sm" truncate highlight={query === '' ? [] : query} fw="inherit" style={{ minWidth: 0 }}>
              {node.name}
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
                inTree
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
                  aria-label={`New note in ${node.name}`}
                  onClick={() => {
                    openFolder(node.path);
                    actions.newNote(node.path);
                  }}
                >
                  <IconPlus size={rowMenuIconSize} />
                </ActionIcon>
              )}
            </div>
          )}
        </div>
      )}

      {node.is_dir && open && (
        <div data-testid="tree-children">
          {drafting && <DraftRow depth={depth + 1} />}
          {!empty && (
            <TreeRows nodes={node.children} depth={depth + 1} filtered={filtered} query={query} />
          )}
          {ghost !== undefined && <GhostRow name={ghost} depth={depth + 1} />}
        </div>
      )}
    </Box>
  );
}

interface FolderIconProps {
  name: string;
  empty: boolean;
  open: boolean;
  onToggle: () => void;
}

function FolderIcon({ name, empty, open, onToggle }: FolderIconProps): JSX.Element {
  const Glyph = open ? IconFolderOpen : IconFolder;
  const Chevron = open ? IconChevronDown : IconChevronRight;
  const state = empty
    ? { 'aria-label': `${open ? 'Close' : 'Open'} ${name}`, 'aria-pressed': open }
    : { 'aria-label': `${open ? 'Collapse' : 'Expand'} ${name}`, 'aria-expanded': open };
  return (
    <ActionIcon
      data-testid={empty ? 'tree-empty-folder' : 'tree-twisty'}
      data-open={open ? 'true' : 'false'}
      variant="subtle"
      color="gray"
      size={iconBox}
      className={treeClasses.icon}
      onClick={onToggle}
      {...state}
    >
      <Glyph size={treeIconSize} className={empty ? undefined : treeClasses.glyph} />
      {!empty && <Chevron size={treeIconSize} className={treeClasses.chevron} />}
    </ActionIcon>
  );
}

function IconBox({ children }: { children: ReactNode }): JSX.Element {
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

interface NameRowProps {
  depth: number;
  testId: string;
  isFile: boolean;
  children: ReactNode;
}

function NameRow({ depth, testId, isFile, children }: NameRowProps): JSX.Element {
  return (
    <Group
      gap={6}
      wrap="nowrap"
      data-testid={testId}
      data-entry={isFile ? 'file' : 'dir'}
      className={`${treeClasses.row} ${treeClasses.draft}`}
      style={rowInsets(depth)}
    >
      {children}
    </Group>
  );
}

function DraftRow({ depth }: { depth: number }): JSX.Element {
  const { submitDraft, cancelDraft } = useFileActions();
  return (
    <NameRow depth={depth} testId="tree-draft" isFile={false}>
      <NameField
        initial=""
        testId="tree-draft"
        icon={<IconBox><IconFolder size={treeIconSize} /></IconBox>}
        className={treeClasses.field}
        placeholder="Folder name"
        label="Name of the new folder"
        onSubmit={submitDraft}
        onCancel={cancelDraft}
      />
    </NameRow>
  );
}

function useGhostIn(folder: string, query: string): string | undefined {
  const { draft } = useShownChrome();
  return draft !== undefined && query === '' && parentOf(draft.path) === folder ? basenameOf(draft.path) : undefined;
}

function GhostRow({ name, depth }: { name: string; depth: number }): JSX.Element {
  return (
    <div data-testid="tree-ghost" data-current="true" className={`${treeClasses.row} ${treeClasses.ghost}`} style={rowInsets(depth)}>
      <IconBox>
        <IconFileText size={treeIconSize} />
      </IconBox>
      <span className={treeClasses.label}>{name}</span>
    </div>
  );
}

function RenameRow({ session, depth }: { session: Renaming; depth: number }): JSX.Element {
  return (
    <NameRow depth={depth} testId="tree-rename" isFile={!session.isDir}>
      <RenameField
        session={session}
        testId="tree-rename"
        icon={<IconBox>{session.isDir ? <IconFolder size={treeIconSize} /> : <IconFileText size={treeIconSize} />}</IconBox>}
        className={treeClasses.field}
      />
    </NameRow>
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
  const contextMenu = usePointerMenu<string>();

  const onFile = !isMarkdown(currentPath) && !isDirectoryPath(location.pathname);
  const currentRow = onFile ? parentOf(currentPath) : currentPath;

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => setSelected(new Set([currentRow])), [currentPath, currentRow]);
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
    () => ({ currentRow, selected, dropTarget, canWrite, pick, startDrag, endDrag, overFolder, leaveFolder, dropOn }),
    [currentRow, selected, dropTarget, canWrite, pick, startDrag, endDrag, overFolder, leaveFolder, dropOn],
  );

  const at = selected.size === 1 ? ([...selected][0] ?? currentPath) : currentPath;
  const here = folderFor(at, nodeAt(tree, at)?.is_dir ?? at === '');
  const draftAtRoot = actions?.draft !== undefined && actions.draft.parent === '';
  const rootGhost = useGhostIn('', trimmed);
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
            <ActionIcon
              data-testid="sidebar-new"
              data-folder={here}
              variant="subtle"
              color="gray"
              size={layout.controlHeight}
              className={sidebarClasses.compose}
              aria-label="New note"
              title={`New note ${inFolder(here, spaceName).toLowerCase()} (N)`}
              onClick={() => actions.newNote(here)}
            >
              <IconCompose size={layout.iconSize} />
            </ActionIcon>
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
        <ScrollArea
          type="hover"
          viewportRef={viewportRef}
          classNames={{ content: sidebarClasses.treeContent }}
          style={{ flex: '1 1 auto', minWidth: 0 }}
        >
          <Stack
            gap={0}
            pb="md"
            data-testid="tree-root"
            data-drop={dropTarget === '' ? 'true' : 'false'}
            {...rootDrop}
            onContextMenu={canWrite ? (event) => contextMenu.onFreeSpace(event, '') : undefined}
            className={sidebarClasses.treeRoot}
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
                <TreeRows nodes={tree} depth={0} filtered={filtered} query={trimmed} />
                {rootGhost !== undefined && <GhostRow name={rootGhost} depth={0} />}
              </>
            )}
          </Stack>
        </ScrollArea>
      </TreeUiContext.Provider>
      {actions !== undefined && (
        <NewEntryMenu
          menu={contextMenu}
          testId="tree-context-menu"
          onCreate={(kind, folder) => (kind === 'note' ? actions.newNote(folder) : actions.newFolder(folder))}
        />
      )}

      {foot !== undefined && <div className={sidebarClasses.foot}>{foot}</div>}
    </div>
  );
}
