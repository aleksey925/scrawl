import { Highlight, Modal, Popover, Portal } from '@mantine/core';
import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react';

import type { NavNode } from '../api/types';
import { FixedAnchor } from '../components/pointerMenu';
import { TapGuard, useTouchScreen } from '../components/TapGuard';
import controls from '../controls.module.css';
import { IconChevronDown, IconChevronRight, IconFolder, IconHome, IconSearch } from '../icons';
import { layout, layoutBreakpoints, useBelow } from '../theme';

import moveClasses from './MoveDialog.module.css';
import picker from './Picker.module.css';
import { basenameOf, joinPath, pageName, parentOf } from './naming';
import { useFullScreenStyle } from './useVisibleArea';

interface Place {
  path: string;
  name: string;
  depth: number;
  holds: ReadonlySet<string>;
  foldable: boolean;
}

const indentStep = 16;
const rowStart = 6;
const popoverWidth = 320;

function namesOf(nodes: readonly NavNode[]): ReadonlySet<string> {
  return new Set(nodes.map((node) => node.name));
}

function foldersOf(nodes: readonly NavNode[], moved: string): NavNode[] {
  return nodes.filter((node) => node.is_dir && node.path !== moved && !node.path.startsWith(`${moved}/`));
}

function collectPlaces(
  nodes: readonly NavNode[], depth: number, moved: string, isOpen: (path: string) => boolean, into: Place[],
): void {
  for (const node of foldersOf(nodes, moved)) {
    const inner = foldersOf(node.children, moved);
    into.push({ path: node.path, name: node.name, depth, holds: namesOf(node.children), foldable: inner.length > 0 });
    if (isOpen(node.path)) {
      collectPlaces(inner, depth + 1, moved, isOpen, into);
    }
  }
}

function placesOf(tree: readonly NavNode[], spaceName: string, moved: string, isOpen: (path: string) => boolean): Place[] {
  const res: Place[] = [{ path: '', name: spaceName, depth: 0, holds: namesOf(tree), foldable: false }];
  collectPlaces(tree, 0, moved, isOpen, res);
  return res;
}

export interface MoveDialogProps {
  path: string;
  isDir: boolean;
  anchor: DOMRect;
  tree: readonly NavNode[];
  spaceName: string;
  onMove: (folder: string) => void;
  onClose: () => void;
}

export function MoveDialog(props: MoveDialogProps): JSX.Element {
  const phone = useBelow(layoutBreakpoints.phone);
  return phone ? <MoveScreen {...props} /> : <MovePopover {...props} />;
}

function MoveScreen(props: MoveDialogProps): JSX.Element {
  const screenStyle = useFullScreenStyle(true);
  return (
    <Modal opened onClose={props.onClose} fullScreen withCloseButton={false} padding={0} trapFocus>
      <div data-testid="move-dialog" className={picker.dialog} style={screenStyle}>
        <MovePicker {...props} phone />
      </div>
    </Modal>
  );
}

function MovePopover(props: MoveDialogProps): JSX.Element {
  const { anchor, onClose } = props;
  const touch = useTouchScreen();
  return (
    <Portal>
      <Popover
        opened
        onDismiss={onClose}
        position={anchor.left + anchor.width / 2 > window.innerWidth / 2 ? 'bottom-end' : 'bottom-start'}
        offset={-anchor.height}
        width={popoverWidth}
        middlewares={{ flip: true, shift: { padding: 8 } }}
        floatingStrategy="fixed"
        withinPortal={false}
        closeOnClickOutside={!touch}
        trapFocus
        radius="lg"
        shadow="md"
        classNames={{ dropdown: controls.menu }}
      >
        <Popover.Target>
          <FixedAnchor rect={anchor} />
        </Popover.Target>
        <Popover.Dropdown p={0}>
          <div data-testid="move-dialog" className={moveClasses.popover}>
            <MovePicker {...props} phone={false} />
          </div>
        </Popover.Dropdown>
      </Popover>
      <TapGuard active onClose={onClose} />
    </Portal>
  );
}

function MovePicker({
  path, isDir, tree, spaceName, onMove, onClose, phone,
}: MoveDialogProps & { phone: boolean }): JSX.Element {
  const [text, setText] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const name = basenameOf(path);
  const here = parentOf(path);
  const query = text.trim().toLowerCase();
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());

  const shown = useMemo(
    () =>
      query === ''
        ? placesOf(tree, spaceName, path, (folder) => open.has(folder))
        : placesOf(tree, spaceName, path, () => true).filter((place) => place.name.toLowerCase().includes(query)),
    [tree, spaceName, path, open, query],
  );
  const [active, setActive] = useState<string | undefined>(undefined);
  const picked = shown.find((place) => place.path === active) ?? shown.find((place) => place.path !== here);

  useEffect(() => setActive(undefined), [query]);

  useEffect(() => {
    bodyRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [picked]);

  const choose = (place: Place | undefined): void => {
    if (place !== undefined && place.path !== here && !place.holds.has(name)) {
      onMove(place.path);
    }
  };

  const fold = (folder: string, opened: boolean): void => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (opened) {
        next.add(folder);
      } else {
        next.delete(folder);
      }
      return next;
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const at = picked === undefined ? -1 : shown.indexOf(picked);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive(shown[Math.min(Math.max(at + step, 0), shown.length - 1)]?.path);
      return;
    }
    if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && query === '' && picked !== undefined) {
      const opening = event.key === 'ArrowRight';
      if (picked.foldable && open.has(picked.path) !== opening) {
        event.preventDefault();
        fold(picked.path, opening);
      }
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      choose(picked);
    }
  };

  const title = pageName(name, isDir);

  return (
    <>
      <div className={phone ? picker.inputRow : moveClasses.search}>
        <div className={phone ? picker.field : moveClasses.searchBox}>
          <IconSearch size={phone ? layout.iconSize : layout.iconSizeSmall} />
          <input
            data-testid="move-input"
            className={phone ? picker.input : moveClasses.input}
            value={text}
            autoFocus
            placeholder={`Move ${title} to…`}
            aria-label={`Move ${title} to a folder`}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setText(event.currentTarget.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        {phone && (
          <button type="button" data-testid="move-close" className={picker.cancel} onClick={onClose}>
            Cancel
          </button>
        )}
      </div>

      <div
        ref={bodyRef}
        className={`${picker.body} ${moveClasses.body}`}
        role="listbox"
        aria-label="Folders"
      >
        {shown.length === 0 && (
          <div data-testid="move-empty" className={picker.empty}>
            No folder matches that.
          </div>
        )}
        {shown.map((place) => {
          const current = place.path === here;
          const opened = open.has(place.path);
          return (
            <div
              key={place.path}
              role="option"
              data-testid="move-place"
              data-path={place.path}
              data-current={current ? 'true' : 'false'}
              data-active={place === picked ? 'true' : 'false'}
              data-open={opened ? 'true' : 'false'}
              aria-selected={place === picked}
              aria-disabled={current}
              className={`${picker.head} ${moveClasses.place}`}
              style={query === '' ? { paddingLeft: rowStart + place.depth * indentStep } : undefined}
              onMouseMove={() => !current && setActive(place.path)}
              onClick={() => choose(place)}
            >
              {query === '' &&
                (place.foldable ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    data-testid="move-twisty"
                    className={moveClasses.twisty}
                    aria-label={`${opened ? 'Collapse' : 'Expand'} ${place.name}`}
                    aria-expanded={opened}
                    onClick={(event) => {
                      event.stopPropagation();
                      fold(place.path, !opened);
                    }}
                  >
                    {opened ? <IconChevronDown size={layout.iconSizeTiny} /> : <IconChevronRight size={layout.iconSizeTiny} />}
                  </button>
                ) : (
                  <span className={moveClasses.twisty} />
                ))}
              {place.path === '' ? <IconHome size={layout.iconSizeSmall} /> : <IconFolder size={layout.iconSizeSmall} />}
              <Highlight component="span" className={picker.title} highlight={query === '' ? [] : query} fw="inherit" size="sm">
                {place.name}
              </Highlight>
              {query !== '' && place.path !== '' && (
                <span className={picker.path}>{parentOf(place.path) === '' ? spaceName : parentOf(place.path)}</span>
              )}
              {current && <span className={picker.count}>Current</span>}
            </div>
          );
        })}
      </div>

      <div data-testid="move-preview" className={picker.footer}>
        {picked === undefined || picked.path === here ? (
          <span>Pick a folder to move {title} into</span>
        ) : picked.holds.has(name) ? (
          <span data-testid="move-taken" className={moveClasses.taken}>
            {picked.name} already holds {name}
          </span>
        ) : (
          <span className={moveClasses.target}>
            Moves to <code>{joinPath(picked.path, name)}</code>
          </span>
        )}
      </div>
    </>
  );
}
