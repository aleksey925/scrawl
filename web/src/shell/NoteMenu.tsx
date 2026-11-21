import { ActionIcon, Menu, Text } from '@mantine/core';
import { useState, type JSX } from 'react';
import { useNavigate } from 'react-router';

import type { DocumentResponse } from '../api/types';
import { absoluteTime } from '../components/formats';
import { FieldMenuItem, menuRectOf, PopupMenu } from '../components/PopupMenu';
import { SheetNote, SheetRow } from '../components/Sheet';
import {
  IconDots, IconEdit, IconHistory, IconLink, IconListSearch, IconMoveTo, IconSearch, IconTrash,
} from '../icons';
import { historyUrl } from '../paths';
import { useFindControl } from '../reader/findControl';
import { layout } from '../theme';

import { ExportItems, ExportTiles, useNoteExport } from './ExportMenu';
import { useFileActions } from './fileActionsContext';
import { useAccount } from './NavContext';
import classes from './NoteMenu.module.css';
import { PageSheet } from './PageSheet';
import { PageWidthControl } from './PageWidthControl';
import { useReaderLayout } from './ReaderLayout';
import { MenuKeys } from './ShortcutHelp';
import { keysLabel, modKey, useKeyboardPlace } from './shortcuts';

let counted: { html: string; words: number } | undefined;

function wordsOf(html: string): number {
  if (counted?.html !== html) {
    const text = new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
    counted = { html, words: text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length };
  }
  return counted.words;
}

function shownWords(html: string, opened: boolean): number {
  return opened || counted?.html === html ? wordsOf(html) : 0;
}

export function NoteMenu({ doc }: { doc: DocumentResponse }): JSX.Element {
  const navigate = useNavigate();
  const { canWrite, me } = useAccount();
  const actions = useFileActions();
  const path = doc.path;
  const exporter = useNoteExport(path);
  const find = useFindControl();
  const { openOutline } = useReaderLayout();
  const keyboard = useKeyboardPlace();
  const [opened, setOpened] = useState(false);
  const words = shownWords(doc.html, opened);

  return (
    <PopupMenu position="bottom-end" width={260} withinPortal opened={opened} onChange={setOpened}>
      <Menu.Target>
        <ActionIcon data-testid="note-menu" variant="subtle" color="gray" size="lg" aria-label="More actions">
          <IconDots size={layout.iconSize} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown data-testid="note-menu-dropdown">
        <PageWidthControl divided />
        {openOutline !== undefined && (
          <Menu.Item
            data-testid="note-menu-outline"
            leftSection={<IconListSearch size={layout.iconSizeSmall} />}
            onClick={openOutline}
          >
            Outline
          </Menu.Item>
        )}
        {find.open !== undefined && (
          <Menu.Item
            data-testid="note-menu-find"
            leftSection={<IconSearch size={layout.iconSizeSmall} />}
            rightSection={keyboard && <MenuKeys>{keysLabel(modKey, 'F')}</MenuKeys>}
            onClick={find.open}
          >
            Find in note
          </Menu.Item>
        )}
        <Menu.Divider />
        <ExportItems {...exporter} />
        <Menu.Divider />
        {me?.history_on === true && (
          <Menu.Item
            data-testid="note-menu-history"
            leftSection={<IconHistory size={layout.iconSizeSmall} />}
            onClick={() => void navigate(historyUrl(path))}
          >
            History
          </Menu.Item>
        )}
        <Menu.Item
          data-testid="note-menu-copy-link"
          leftSection={<IconLink size={layout.iconSizeSmall} />}
          onClick={() => actions.copyLink(path, false)}
        >
          Copy link
        </Menu.Item>
        {canWrite && (
          <>
            <FieldMenuItem
              data-testid="note-menu-rename"
              leftSection={<IconEdit size={layout.iconSizeSmall} />}
              onClick={() => actions.startRename(path, false, 'page')}
            >
              Rename
            </FieldMenuItem>
            <Menu.Item
              data-testid="note-menu-move"
              leftSection={<IconMoveTo size={layout.iconSizeSmall} />}
              onClick={(event) => actions.moveTo(path, menuRectOf(event.currentTarget))}
            >
              Move to
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item
              data-testid="note-menu-delete"
              color="red"
              leftSection={<IconTrash size={layout.iconSizeSmall} />}
              onClick={() => actions.remove(path)}
            >
              Delete
            </Menu.Item>
          </>
        )}
        <Menu.Divider />
        <Text data-testid="note-menu-about" className={classes.about}>
          Words: {words.toLocaleString()}
          {doc.mod_time !== '' && (
            <>
              <br />
              Last edited {absoluteTime(doc.mod_time)}
            </>
          )}
        </Text>
      </Menu.Dropdown>
    </PopupMenu>
  );
}

export interface NoteSheetProps {
  doc: DocumentResponse;
  opened: boolean;
  onClose: () => void;
}

export function NoteSheet({ doc, opened, onClose }: NoteSheetProps): JSX.Element {
  const { me } = useAccount();
  const exporter = useNoteExport(doc.path);
  const words = shownWords(doc.html, opened);
  const pick = (action: () => void): void => {
    onClose();
    action();
  };

  return (
    <PageSheet
      path={doc.path}
      title={doc.title}
      testPrefix="note-menu"
      opened={opened}
      onClose={onClose}
      tiles={<ExportTiles print={() => pick(exporter.print)} download={(format) => pick(() => exporter.download(format))} />}
      lead={
        me?.history_on === true && (
          <SheetRow testId="note-menu-history" icon={IconHistory} label="History" to={historyUrl(doc.path)} onClick={onClose} />
        )
      }
      about={
        <SheetNote data-testid="note-menu-about">
          {words.toLocaleString()} {words === 1 ? 'word' : 'words'}
          {doc.mod_time !== '' && ` · Last edited ${absoluteTime(doc.mod_time)}`}
        </SheetNote>
      }
    />
  );
}
