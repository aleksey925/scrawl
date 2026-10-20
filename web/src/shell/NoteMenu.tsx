import { ActionIcon, Menu, Text } from '@mantine/core';
import { useMemo, useState, type JSX } from 'react';
import { useNavigate } from 'react-router';

import type { DocumentResponse } from '../api/types';
import { absoluteTime } from '../components/formats';
import { SheetMenu } from '../components/SheetMenu';
import { IconDots, IconEdit, IconHistory, IconLink, IconListSearch, IconSearch, IconTrash } from '../icons';
import { useFindControl } from '../reader/findControl';
import { historyUrl } from '../paths';
import { layout, layoutBreakpoints, useAtLeast } from '../theme';

import { ExportItems, useNoteExport } from './ExportMenu';
import { useFileActions } from './fileActionsContext';
import { useNav } from './NavContext';
import classes from './NoteMenu.module.css';
import { PageWidthControl } from './PageWidthControl';
import { useReaderLayout } from './ReaderLayout';

const apple = /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
const findKeys = apple ? '⌘F' : 'Ctrl+F';

// wordsOf counts the words a reader sees in the rendered note, so markup and
// addresses are not counted
function wordsOf(html: string): number {
  const text = new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

// NoteMenu is the note's `⋯`: how wide it is read, the find, the exports, its
// versions, what can be done to the file, and a line about the note
export function NoteMenu({ doc }: { doc: DocumentResponse }): JSX.Element {
  const navigate = useNavigate();
  const { canWrite, me } = useNav();
  const actions = useFileActions();
  const path = doc.path;
  const exporter = useNoteExport(path);
  const find = useFindControl();
  const { openOutline } = useReaderLayout();
  const wide = useAtLeast(layoutBreakpoints.sidebar);
  const [opened, setOpened] = useState(false);
  const words = useMemo(() => (opened ? wordsOf(doc.html) : 0), [opened, doc.html]);

  return (
    <SheetMenu position="bottom-end" width={260} withinPortal opened={opened} onChange={setOpened}>
      <Menu.Target>
        <ActionIcon data-testid="note-menu" variant="subtle" color="gray" size="lg" aria-label="More actions">
          <IconDots size={layout.iconSize} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown data-testid="note-menu-dropdown">
        <PageWidthControl />
        {wide && <Menu.Divider />}
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
            rightSection={<span className={classes.keys}>{findKeys}</span>}
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
            <Menu.Item
              data-testid="note-menu-rename"
              leftSection={<IconEdit size={layout.iconSizeSmall} />}
              onClick={() => actions.rename(path, false)}
            >
              Rename or move
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item
              data-testid="note-menu-delete"
              color="red"
              leftSection={<IconTrash size={layout.iconSizeSmall} />}
              onClick={() => actions.remove(path, false)}
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
    </SheetMenu>
  );
}
