import { ActionIcon, Menu } from '@mantine/core';
import {
  IconDots, IconEdit, IconFile, IconFolder, IconFolderPlus, IconLink, IconPlus, IconTrash,
} from '@tabler/icons-react';
import { useEffect, useState, type JSX } from 'react';
import { useNavigate } from 'react-router';

import { directoryUrl, documentUrl, editUrl } from '../paths';

import { useFileActions } from './FileActions';
import { useNav } from './NavContext';
import { parentOf } from './naming';

const iconSize = 16;

export interface RowMenuProps {
  path: string;
  isDir: boolean;
  name: string;
  touch: boolean;
}

export function RowMenu({ path, isDir, name, touch }: RowMenuProps): JSX.Element {
  const navigate = useNavigate();
  const { canWrite } = useNav();
  const actions = useFileActions();
  const [opened, setOpened] = useState(false);

  // the dropdown is anchored to a row inside a panel that scrolls on its own,
  // so anything that moves the trigger has to take the menu with it
  useEffect(() => {
    if (!opened) {
      return;
    }
    const close = (): void => setOpened(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [opened]);

  const folder = isDir ? path : parentOf(path);
  const open = (): void => void navigate(isDir ? directoryUrl(path) : documentUrl(path));

  return (
    <Menu opened={opened} onChange={setOpened} position="bottom-end" withinPortal shadow="md" width={200}>
      <Menu.Target>
        <ActionIcon
          data-testid="tree-row-menu"
          data-path={path}
          variant="subtle"
          color="gray"
          size={touch ? 'lg' : 'sm'}
          style={{ flex: 'none' }}
          aria-label={`Actions for ${name}`}
        >
          <IconDots size={iconSize} />
        </ActionIcon>
      </Menu.Target>

      <Menu.Dropdown data-testid="tree-row-menu-dropdown">
        <Menu.Item
          data-testid="tree-row-menu-open"
          leftSection={isDir ? <IconFolder size={iconSize} /> : <IconFile size={iconSize} />}
          onClick={open}
        >
          Open
        </Menu.Item>
        {!isDir && canWrite && (
          <Menu.Item
            data-testid="tree-row-menu-edit"
            leftSection={<IconEdit size={iconSize} />}
            onClick={() => void navigate(editUrl(path))}
          >
            Edit
          </Menu.Item>
        )}

        {canWrite && (
          <>
            <Menu.Divider />
            <Menu.Item
              data-testid="tree-row-menu-new-page"
              leftSection={<IconPlus size={iconSize} />}
              onClick={() => actions.createPage(folder)}
            >
              New file
            </Menu.Item>
            <Menu.Item
              data-testid="tree-row-menu-new-folder"
              leftSection={<IconFolderPlus size={iconSize} />}
              onClick={() => actions.createFolder(folder)}
            >
              New folder
            </Menu.Item>
          </>
        )}

        <Menu.Divider />
        {/* the root holds everything: it is not a folder anyone may rename or drop */}
        {canWrite && path !== '' && (
          <Menu.Item
            data-testid="tree-row-menu-rename"
            leftSection={<IconEdit size={iconSize} />}
            onClick={() => actions.rename(path, isDir)}
          >
            Rename
          </Menu.Item>
        )}
        <Menu.Item
          data-testid="tree-row-menu-copy-link"
          leftSection={<IconLink size={iconSize} />}
          onClick={() => actions.copyLink(path, isDir)}
        >
          Copy link
        </Menu.Item>

        {canWrite && path !== '' && (
          <>
            <Menu.Divider />
            <Menu.Item
              data-testid="tree-row-menu-delete"
              color="red"
              leftSection={<IconTrash size={iconSize} />}
              onClick={() => actions.remove(path, isDir)}
            >
              Delete
            </Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
