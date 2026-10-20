import { ActionIcon, Menu } from '@mantine/core';
import { IconDots, IconEdit, IconHistory, IconLink, IconListSearch, IconSearch, IconTrash } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useNavigate } from 'react-router';

import type { DocumentResponse } from '../api/types';
import { SheetMenu } from '../components/SheetMenu';
import { useFindControl } from '../reader/findControl';
import { historyUrl } from '../paths';
import { layout } from '../theme';

import { ExportItems, useNoteExport } from './ExportMenu';
import { useFileActions } from './fileActionsContext';
import { useNav } from './NavContext';
import { useReaderLayout } from './ReaderLayout';
import { PageWidthControl } from './PageWidthControl';

// NoteMenu is the note's `⋯`: how wide it is read, the exports, its versions
// and what can be done to the file itself
export function NoteMenu({ doc }: { doc: DocumentResponse }): JSX.Element {
  const navigate = useNavigate();
  const { canWrite, me } = useNav();
  const actions = useFileActions();
  const path = doc.path;
  const exporter = useNoteExport(path);
  const find = useFindControl();
  const { openOutline } = useReaderLayout();

  return (
    <SheetMenu position="bottom-end" width={260} withinPortal>
      <Menu.Target>
        <ActionIcon data-testid="note-menu" variant="subtle" color="gray" size="lg" aria-label="More actions">
          <IconDots size={layout.iconSize} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown data-testid="note-menu-dropdown">
        {openOutline !== undefined && (
          <Menu.Item
            data-testid="note-menu-outline"
            leftSection={<IconListSearch size={layout.iconSizeSmall} />}
            onClick={openOutline}
          >
            Outline
          </Menu.Item>
        )}
        <PageWidthControl />
        <ExportItems {...exporter} />
        <Menu.Divider />
        {find.open !== undefined && (
          <Menu.Item
            data-testid="note-menu-find"
            leftSection={<IconSearch size={layout.iconSizeSmall} />}
            onClick={find.open}
          >
            Find in note
          </Menu.Item>
        )}
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
              Rename
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
      </Menu.Dropdown>
    </SheetMenu>
  );
}
