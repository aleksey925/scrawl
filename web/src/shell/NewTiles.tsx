import { Portal, Transition } from '@mantine/core';
import { useFocusTrap } from '@mantine/hooks';
import { useEffect, useRef, type JSX } from 'react';

import { motionMs } from '../components/screenMotion';
import { IconFilePlus, IconFolderPlus, type Icon } from '../icons';
import { layout } from '../theme';

import classes from './NewTiles.module.css';

const fadeMs = 160;

export interface NewTilesProps {
  opened: boolean;
  onClose: () => void;
  onFolder: () => void;
  onNote: () => void;
}

export function NewTiles({ opened, onClose, onFolder, onNote }: NewTilesProps): JSX.Element {
  const trap = useFocusTrap(opened);
  const pressed = useRef(false);

  useEffect(() => {
    pressed.current = false;
    if (!opened) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [opened, onClose]);

  return (
    <Transition mounted={opened} transition="fade" duration={motionMs(fadeMs)}>
      {(style) => (
        <Portal>
          <div className={classes.layer} style={style}>
            <div
              data-testid="new-scrim"
              className={classes.scrim}
              onPointerDown={() => {
                pressed.current = true;
              }}
              onClick={() => {
                if (pressed.current) {
                  pressed.current = false;
                  onClose();
                }
              }}
            />
            <div ref={trap} data-testid="new-menu" role="menu" aria-label="New" className={classes.tiles}>
              <Tile testId="new-menu-folder" label="New folder" icon={IconFolderPlus} onClick={onFolder} />
              <Tile testId="new-menu-note" label="New note" icon={IconFilePlus} onClick={onNote} />
            </div>
          </div>
        </Portal>
      )}
    </Transition>
  );
}

interface TileProps {
  testId: string;
  label: string;
  icon: Icon;
  onClick: () => void;
}

function Tile({ testId, label, icon: TileIcon, onClick }: TileProps): JSX.Element {
  return (
    <button type="button" role="menuitem" data-testid={testId} className={classes.tile} onClick={onClick}>
      <TileIcon size={layout.iconSizeTile} aria-hidden />
      <span>{label}</span>
    </button>
  );
}
