import { Highlight, Modal } from '@mantine/core';
import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react';

import type { NavNode } from '../api/types';
import { IconFolder, IconHome, IconSearch } from '../icons';
import { layout, layoutBreakpoints, useBelow } from '../theme';

import classes from './Search.module.css';
import moveClasses from './MoveDialog.module.css';
import { basenameOf, joinPath, pageName, parentOf } from './naming';
import { useVisibleArea } from './useVisibleArea';

interface Place {
  path: string;
  name: string;
  depth: number;
  holds: ReadonlySet<string>;
}

const indentStep = 16;
const rowStart = 10;

function namesOf(nodes: readonly NavNode[]): ReadonlySet<string> {
  return new Set(nodes.map((node) => node.name));
}

function collectPlaces(nodes: readonly NavNode[], depth: number, moved: string, into: Place[]): void {
  for (const node of nodes) {
    if (!node.is_dir || node.path === moved || node.path.startsWith(`${moved}/`)) {
      continue;
    }
    into.push({ path: node.path, name: node.name, depth, holds: namesOf(node.children) });
    collectPlaces(node.children, depth + 1, moved, into);
  }
}

function placesOf(tree: readonly NavNode[], spaceName: string, moved: string): Place[] {
  const res: Place[] = [{ path: '', name: spaceName, depth: 0, holds: namesOf(tree) }];
  collectPlaces(tree, 1, moved, res);
  return res;
}

export interface MoveDialogProps {
  path: string;
  isDir: boolean;
  tree: readonly NavNode[];
  spaceName: string;
  onMove: (folder: string) => void;
  onClose: () => void;
}

export function MoveDialog({ path, isDir, tree, spaceName, onMove, onClose }: MoveDialogProps): JSX.Element {
  const phone = useBelow(layoutBreakpoints.phone);
  const area = useVisibleArea(phone);
  const [text, setText] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const name = basenameOf(path);
  const here = parentOf(path);
  const query = text.trim().toLowerCase();

  const places = useMemo(() => placesOf(tree, spaceName, path), [tree, spaceName, path]);
  const shown = useMemo(
    () => (query === '' ? places : places.filter((place) => place.name.toLowerCase().includes(query))),
    [places, query],
  );
  const choices = useMemo(() => shown.filter((place) => place.path !== here), [shown, here]);
  const [active, setActive] = useState<string | undefined>(undefined);
  const picked = choices.find((place) => place.path === active) ?? choices[0];

  useEffect(() => setActive(undefined), [query]);

  useEffect(() => {
    bodyRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [picked]);

  const choose = (place: Place | undefined): void => {
    if (place !== undefined && place.path !== here && !place.holds.has(name)) {
      onMove(place.path);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const at = picked === undefined ? -1 : choices.indexOf(picked);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive(choices[Math.min(Math.max(at + step, 0), choices.length - 1)]?.path);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      choose(picked);
    }
  };

  const title = pageName(name, isDir);

  return (
    <Modal
      opened
      onClose={onClose}
      size={460}
      yOffset="10vh"
      fullScreen={phone}
      withCloseButton={false}
      padding={0}
      trapFocus
    >
      <div
        data-testid="move-dialog"
        className={classes.dialog}
        style={
          phone
            ? { maxHeight: 'none', height: area === undefined ? '100dvh' : area.height, transform: `translateY(${area?.top ?? 0}px)` }
            : undefined
        }
      >
        <div className={classes.inputRow}>
          <div className={classes.field}>
            <IconSearch size={layout.iconSize} />
            <input
              data-testid="move-input"
              className={classes.input}
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
            <button type="button" data-testid="move-close" className={classes.cancel} onClick={onClose}>
              Cancel
            </button>
          )}
        </div>

        <div ref={bodyRef} className={classes.body} role="listbox" aria-label="Folders">
          {shown.length === 0 && (
            <div data-testid="move-empty" className={classes.empty}>
              No folder matches that.
            </div>
          )}
          {shown.map((place) => {
            const current = place.path === here;
            return (
              <button
                key={place.path}
                type="button"
                role="option"
                data-testid="move-place"
                data-path={place.path}
                data-current={current ? 'true' : 'false'}
                data-active={place === picked ? 'true' : 'false'}
                aria-selected={place === picked}
                aria-disabled={current}
                className={`${classes.head} ${moveClasses.place}`}
                style={query === '' ? { paddingLeft: rowStart + place.depth * indentStep } : undefined}
                onMouseMove={() => !current && setActive(place.path)}
                onClick={() => choose(place)}
              >
                {place.path === '' ? <IconHome size={layout.iconSizeSmall} /> : <IconFolder size={layout.iconSizeSmall} />}
                <Highlight component="span" className={classes.title} highlight={query === '' ? [] : query} fw="inherit" size="sm">
                  {place.name}
                </Highlight>
                {query !== '' && place.path !== '' && (
                  <span className={classes.path}>{parentOf(place.path) === '' ? spaceName : parentOf(place.path)}</span>
                )}
                {current && <span className={classes.count}>Current</span>}
              </button>
            );
          })}
        </div>

        <div data-testid="move-preview" className={classes.footer}>
          {picked === undefined ? (
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
      </div>
    </Modal>
  );
}
