import { Highlight, Popover, Portal } from '@mantine/core';
import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent, type RefObject } from 'react';

import type { NavNode } from '../api/types';
import { FixedAnchor } from '../components/pointerMenu';
import { Sheet, SheetButton } from '../components/Sheet';
import { TapGuard, useTouchScreen } from '../components/TapGuard';
import controls from '../controls.module.css';
import { IconChevronDown, IconChevronRight, IconFolder, IconHome, IconSearch } from '../icons';
import { layout, layoutBreakpoints, useBelow } from '../theme';

import moveClasses from './MoveDialog.module.css';
import picker from './Picker.module.css';
import { basenameOf, joinPath, parentOf } from './naming';

interface Place {
  path: string;
  name: string;
  depth: number;
  holds: ReadonlySet<string>;
  foldable: boolean;
}

const indentStep = 16;
const rowStart = 6;
const sheetRowStart = 16;

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
  anchor: DOMRect;
  tree: readonly NavNode[];
  spaceName: string;
  onMove: (folder: string) => void;
  onClose: () => void;
}

export function MoveDialog(props: MoveDialogProps): JSX.Element {
  const phone = useBelow(layoutBreakpoints.phone);
  return phone ? <MoveSheet {...props} /> : <MovePopover {...props} />;
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
        width={layout.popoverWidth}
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
            <MovePicker {...props} />
          </div>
        </Popover.Dropdown>
      </Popover>
      <TapGuard active onClose={onClose} />
    </Portal>
  );
}

interface MovePlaces {
  name: string;
  here: string;
  text: string;
  setText: (text: string) => void;
  query: string;
  shown: readonly Place[];
  picked: Place | undefined;
  setActive: (path: string) => void;
  open: ReadonlySet<string>;
  fold: (folder: string, opened: boolean) => void;
  choose: (place: Place | undefined) => void;
  bodyRef: RefObject<HTMLDivElement | null>;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

function useMovePlaces({ path, tree, spaceName, onMove }: MoveDialogProps, pickFirst: boolean): MovePlaces {
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
  const first = pickFirst || query !== '' ? shown.find((place) => place.path !== here) : undefined;
  const picked = shown.find((place) => place.path === active) ?? first;

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

  return { name, here, text, setText, query, shown, picked, setActive, open, fold, choose, bodyRef, onKeyDown };
}

interface MoveInputProps {
  places: MovePlaces;
  className: string | undefined;
  autoFocus: boolean;
}

function MoveInput({ places, className, autoFocus }: MoveInputProps): JSX.Element {
  const { name, text, setText, onKeyDown } = places;
  return (
    <input
      data-testid="move-input"
      className={className}
      value={text}
      autoFocus={autoFocus}
      placeholder={`Move ${name} to…`}
      aria-label={`Move ${name} to a folder`}
      autoComplete="off"
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      enterKeyHint="go"
      onChange={(event) => setText(event.currentTarget.value)}
      onKeyDown={onKeyDown}
    />
  );
}

function placeAttributes(place: Place, places: MovePlaces): Record<string, string | boolean> {
  const current = place.path === places.here;
  return {
    role: 'option',
    'data-testid': 'move-place',
    'data-path': place.path,
    'data-current': current ? 'true' : 'false',
    'data-active': place === places.picked ? 'true' : 'false',
    'data-open': places.open.has(place.path) ? 'true' : 'false',
    'aria-selected': place === places.picked,
    'aria-disabled': current,
  };
}

function MoveTwisty({ place, places, className }: { place: Place; places: MovePlaces; className: string | undefined }): JSX.Element {
  const opened = places.open.has(place.path);
  return (
    <button
      type="button"
      tabIndex={-1}
      data-testid="move-twisty"
      className={className}
      aria-label={`${opened ? 'Collapse' : 'Expand'} ${place.name}`}
      aria-expanded={opened}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.stopPropagation();
        places.fold(place.path, !opened);
      }}
    >
      {opened ? <IconChevronDown size={layout.iconSizeTiny} /> : <IconChevronRight size={layout.iconSizeTiny} />}
    </button>
  );
}

function MovePicker(props: MoveDialogProps): JSX.Element {
  const { spaceName } = props;
  const places = useMovePlaces(props, true);
  const { name, here, query, shown, picked, setActive, choose, bodyRef } = places;

  return (
    <>
      <div className={moveClasses.search}>
        <div className={moveClasses.searchBox}>
          <IconSearch size={layout.iconSizeSmall} />
          <MoveInput places={places} className={moveClasses.input} autoFocus />
        </div>
      </div>

      <div ref={bodyRef} className={`${picker.body} ${moveClasses.body}`} role="listbox" aria-label="Folders">
        {shown.length === 0 && (
          <div data-testid="move-empty" className={picker.empty}>
            No folder matches that.
          </div>
        )}
        {shown.map((place) => {
          const current = place.path === here;
          return (
            <div
              key={place.path}
              {...placeAttributes(place, places)}
              className={`${picker.head} ${moveClasses.place}`}
              style={query === '' ? { paddingLeft: rowStart + place.depth * indentStep } : undefined}
              onMouseMove={() => !current && setActive(place.path)}
              onClick={() => choose(place)}
            >
              {query === '' &&
                (place.foldable ? (
                  <MoveTwisty place={place} places={places} className={moveClasses.twisty} />
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
          <span>Pick a folder to move {name} into</span>
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

function MoveSheet(props: MoveDialogProps): JSX.Element {
  const { spaceName, onClose } = props;
  const places = useMovePlaces(props, false);
  const { name, here, query, shown, picked, setActive, choose, bodyRef } = places;
  const taken = picked !== undefined && picked.holds.has(name);

  return (
    <Sheet
      opened
      onClose={onClose}
      testId="move-dialog"
      tall
      title={`Move ${name}`}
      subtitle="Pick a folder"
      footer={
        <div data-testid="move-preview" className={moveClasses.sheetFoot}>
          {taken && (
            <span data-testid="move-taken" className={moveClasses.taken}>
              {picked.name} already holds {name}
            </span>
          )}
          <SheetButton testId="move-submit" disabled={picked === undefined || taken} onClick={() => choose(picked)}>
            {picked === undefined ? 'Move' : `Move to ${picked.name}`}
          </SheetButton>
        </div>
      }
    >
      <label className={moveClasses.sheetSearch}>
        <IconSearch size={layout.iconSizeSmall} aria-hidden />
        <MoveInput places={places} className={moveClasses.sheetInput} autoFocus={false} />
      </label>
      <div ref={bodyRef} className={moveClasses.sheetList} role="listbox" aria-label="Folders">
        {shown.length === 0 && (
          <div data-testid="move-empty" className={moveClasses.sheetEmpty}>
            No folder matches that.
          </div>
        )}
        {shown.map((place) => {
          const current = place.path === here;
          return (
            <div
              key={place.path}
              {...placeAttributes(place, places)}
              className={moveClasses.sheetPlace}
              style={query === '' ? { paddingLeft: sheetRowStart + place.depth * indentStep } : undefined}
              onClick={() => !current && setActive(place.path)}
            >
              <IconFolder size={layout.iconSizeLarge} className={moveClasses.sheetIcon} aria-hidden />
              <span className={moveClasses.sheetName}>
                <Highlight component="span" highlight={query === '' ? [] : query} fw="inherit" fz="inherit">
                  {place.name}
                </Highlight>
                {query !== '' && place.path !== '' && (
                  <span className={moveClasses.sheetPath}>{parentOf(place.path) === '' ? spaceName : parentOf(place.path)}</span>
                )}
              </span>
              {current && <span className={moveClasses.sheetCurrent}>current</span>}
              {query === '' && place.foldable && <MoveTwisty place={place} places={places} className={moveClasses.sheetTwisty} />}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
